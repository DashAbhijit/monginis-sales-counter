import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  buildReportText,
  createItem,
  deleteItem,
  ensureDailyReset,
  exportBackupData,
  formatDateLabel,
  formatPrice,
  getHistorySummaries,
  getHistoryReport,
  listActiveItems,
  restoreBackupData,
  setItemQuantity,
  updateItem,
} from './src/data/database';
import { CATEGORY_OPTIONS, type Category, type DailyReport, type HistorySummary, type ItemWithQuantity } from './src/types';

type ScreenKey = 'counter' | 'report' | 'history' | 'backup';
type FilterCategory = 'All' | Category;

const SCREEN_OPTIONS: Array<{ key: ScreenKey; label: string }> = [
  { key: 'counter', label: 'Counter' },
  { key: 'report', label: 'Today' },
  { key: 'history', label: 'History' },
  { key: 'backup', label: 'Backup' },
];

const CATEGORY_FILTERS: FilterCategory[] = ['All', ...CATEGORY_OPTIONS];

function makeReportFromItems(reportDate: string, items: ItemWithQuantity[]): DailyReport {
  const soldItems = items
    .filter((item) => item.quantity > 0)
    .map((item) => ({
      itemId: item.id,
      itemName: item.name,
      category: item.category,
      price: item.price,
      quantity: item.quantity,
    }))
    .sort((left, right) => {
      const categoryCompare = left.category.localeCompare(right.category);
      if (categoryCompare !== 0) {
        return categoryCompare;
      }

      return left.itemName.localeCompare(right.itemName);
    });

  return {
    reportDate,
    totalQuantity: soldItems.reduce((sum, item) => sum + item.quantity, 0),
    lineCount: soldItems.length,
    items: soldItems,
  };
}

function escapeCsv(value: string | number | null) {
  const text = value === null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

async function ensureExportsDirectory() {
  const exportsDirectory = new Directory(Paths.document, 'exports');
  if (!exportsDirectory.exists) {
    exportsDirectory.create({ intermediates: true, idempotent: true });
  }

  return exportsDirectory;
}

async function shareFile(file: File, mimeType: string, dialogTitle: string) {
  const canShare = await Sharing.isAvailableAsync();

  if (!canShare) {
    Alert.alert('Sharing unavailable', 'This device cannot open the share sheet right now.');
    return;
  }

  await Sharing.shareAsync(file.uri, {
    dialogTitle,
    mimeType,
  });
}

export default function App() {
  const [screen, setScreen] = useState<ScreenKey>('counter');
  const [todayDate, setTodayDate] = useState('');
  const [items, setItems] = useState<ItemWithQuantity[]>([]);
  const [history, setHistory] = useState<HistorySummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<FilterCategory>('All');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [itemModalVisible, setItemModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<ItemWithQuantity | null>(null);
  const [itemName, setItemName] = useState('');
  const [itemCategory, setItemCategory] = useState<Category>('Small Cake Items');
  const [itemPrice, setItemPrice] = useState('');

  const [quantityModalVisible, setQuantityModalVisible] = useState(false);
  const [quantityItem, setQuantityItem] = useState<ItemWithQuantity | null>(null);
  const [quantityValue, setQuantityValue] = useState('0');

  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [selectedHistoryReport, setSelectedHistoryReport] = useState<DailyReport | null>(null);
  const [loadingHistoryReport, setLoadingHistoryReport] = useState(false);

  const todayReport = makeReportFromItems(todayDate, items);

  const filteredItems = items.filter((item) => {
    const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.trim().toLowerCase());
    return matchesCategory && matchesSearch;
  });

  async function loadAppData(showSpinner = true) {
    if (showSpinner) {
      setLoading(true);
    }

    try {
      const resetDate = await ensureDailyReset();
      const [nextItems, nextHistory] = await Promise.all([listActiveItems(), getHistorySummaries()]);
      setTodayDate(resetDate);
      setItems(nextItems);
      setHistory(nextHistory);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load your shop data.';
      Alert.alert('Load failed', message);
    } finally {
      if (showSpinner) {
        setLoading(false);
      }
    }
  }

  async function refreshHistoryOnly() {
    try {
      const nextHistory = await getHistorySummaries();
      setHistory(nextHistory);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to refresh history.';
      Alert.alert('History refresh failed', message);
    }
  }

  useEffect(() => {
    void loadAppData();

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void loadAppData(false);
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  function openAddItemModal() {
    setEditingItem(null);
    setItemName('');
    setItemCategory('Small Cake Items');
    setItemPrice('');
    setItemModalVisible(true);
  }

  function openEditItemModal(item: ItemWithQuantity) {
    setEditingItem(item);
    setItemName(item.name);
    setItemCategory(item.category);
    setItemPrice(item.price === null ? '' : String(item.price));
    setItemModalVisible(true);
  }

  function openQuantityModal(item: ItemWithQuantity) {
    setQuantityItem(item);
    setQuantityValue(String(item.quantity));
    setQuantityModalVisible(true);
  }

  async function handleQuantityChange(item: ItemWithQuantity, nextQuantity: number) {
    const safeQuantity = Math.max(0, Math.floor(nextQuantity));

    setItems((currentItems) =>
      currentItems.map((currentItem) =>
        currentItem.id === item.id ? { ...currentItem, quantity: safeQuantity } : currentItem
      )
    );

    try {
      await setItemQuantity(item.id, safeQuantity);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save quantity.';
      Alert.alert('Save failed', message);
      await loadAppData(false);
    }
  }

  async function handleItemSubmit() {
    const trimmedName = itemName.trim();
    if (!trimmedName) {
      Alert.alert('Item name needed', 'Please enter an item name.');
      return;
    }

    const parsedPrice = itemPrice.trim() === '' ? null : Number(itemPrice);
    if (parsedPrice !== null && (Number.isNaN(parsedPrice) || parsedPrice < 0)) {
      Alert.alert('Invalid price', 'Enter a valid positive price or leave it empty.');
      return;
    }

    setSaving(true);
    try {
      if (editingItem) {
        await updateItem(editingItem.id, {
          name: trimmedName,
          category: itemCategory,
          price: parsedPrice,
        });
      } else {
        await createItem({
          name: trimmedName,
          category: itemCategory,
          price: parsedPrice,
        });
      }

      setItemModalVisible(false);
      await loadAppData(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save this item.';
      Alert.alert('Save failed', message);
    } finally {
      setSaving(false);
    }
  }

  function confirmDeleteCurrentItem() {
    if (!editingItem) {
      return;
    }

    Alert.alert(
      'Delete item?',
      'The item will be hidden from the counter. Old reports stay saved.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setSaving(true);
              try {
                await deleteItem(editingItem.id);
                setItemModalVisible(false);
                await loadAppData(false);
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : 'Unable to delete this item.';
                Alert.alert('Delete failed', message);
              } finally {
                setSaving(false);
              }
            })();
          },
        },
      ]
    );
  }

  async function saveManualQuantity() {
    if (!quantityItem) {
      return;
    }

    const parsedQuantity = Number(quantityValue);
    if (Number.isNaN(parsedQuantity) || parsedQuantity < 0) {
      Alert.alert('Invalid quantity', 'Enter 0 or a higher whole number.');
      return;
    }

    await handleQuantityChange(quantityItem, parsedQuantity);
    setQuantityModalVisible(false);
  }

  async function copyTodayReport() {
    try {
      await Clipboard.setStringAsync(buildReportText(todayReport));
      Alert.alert('Copied', 'Today’s report has been copied as text.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to copy the report.';
      Alert.alert('Copy failed', message);
    }
  }

  async function exportTodayCsv() {
    try {
      const exportsDirectory = await ensureExportsDirectory();
      const csvFile = new File(exportsDirectory, `monginis-report-${todayDate}.csv`);
      if (csvFile.exists) {
        csvFile.delete();
      }
      csvFile.create();

      const rows = [
        ['Date', todayDate],
        ['Total Items Sold', todayReport.totalQuantity],
        [],
        ['Item Name', 'Category', 'Quantity Sold'],
        ...todayReport.items.map((item) => [item.itemName, item.category, item.quantity]),
      ];
      const csv = rows
        .map((row) => row.map((value) => escapeCsv(value ?? '')).join(','))
        .join('\n');

      csvFile.write(csv);
      await shareFile(csvFile, 'text/csv', 'Share today’s CSV report');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to export CSV.';
      Alert.alert('Export failed', message);
    }
  }

  async function exportTodayPdf() {
    try {
      const rowsHtml = todayReport.items
        .map(
          (item) => `
            <tr>
              <td>${item.itemName}</td>
              <td>${item.category}</td>
              <td style="text-align:right;">${item.quantity}</td>
            </tr>
          `
        )
        .join('');

      const html = `
        <html>
          <body style="font-family: Arial, sans-serif; padding: 24px; color: #2f261f;">
            <h1 style="margin-bottom: 8px;">Monginis Sales Report</h1>
            <p style="margin-top: 0;">${formatDateLabel(todayDate)}</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
              <thead>
                <tr>
                  <th style="border-bottom: 1px solid #d7c6b7; padding: 8px; text-align: left;">Item</th>
                  <th style="border-bottom: 1px solid #d7c6b7; padding: 8px; text-align: left;">Category</th>
                  <th style="border-bottom: 1px solid #d7c6b7; padding: 8px; text-align: right;">Qty</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
            <p style="margin-top: 24px; font-size: 18px;"><strong>Total items sold:</strong> ${todayReport.totalQuantity}</p>
          </body>
        </html>
      `;

      const pdf = await Print.printToFileAsync({
        html,
      });

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Sharing unavailable', 'PDF created, but this device cannot open the share sheet.');
        return;
      }

      await Sharing.shareAsync(pdf.uri, {
        dialogTitle: 'Share today’s PDF report',
        mimeType: 'application/pdf',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to export PDF.';
      Alert.alert('Export failed', message);
    }
  }

  async function exportBackupJson() {
    try {
      const exportsDirectory = await ensureExportsDirectory();
      const backupFile = new File(exportsDirectory, `monginis-backup-${todayDate}.json`);
      if (backupFile.exists) {
        backupFile.delete();
      }
      backupFile.create();
      const payload = await exportBackupData();
      backupFile.write(JSON.stringify(payload, null, 2));
      await shareFile(backupFile, 'application/json', 'Share backup file');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create backup.';
      Alert.alert('Backup failed', message);
    }
  }

  async function restoreBackupJson() {
    try {
      const pickedDocument = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        type: ['application/json', 'text/json', '*/*'],
      });

      if (pickedDocument.canceled || !pickedDocument.assets?.length) {
        return;
      }

      const selectedFile = new File(pickedDocument.assets[0].uri);
      const content = await selectedFile.text();
      const payload = JSON.parse(content);

      Alert.alert(
        'Restore backup?',
        'This will replace the current item list, quantities, and report history on this phone.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Restore',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                setSaving(true);
                try {
                  await restoreBackupData(payload);
                  const refreshedDate = await ensureDailyReset();
                  const [nextItems, nextHistory] = await Promise.all([
                    listActiveItems(),
                    getHistorySummaries(),
                  ]);
                  setTodayDate(refreshedDate);
                  setItems(nextItems);
                  setHistory(nextHistory);
                  Alert.alert('Restore complete', 'Your backup data has been restored.');
                } catch (error) {
                  const message =
                    error instanceof Error ? error.message : 'Unable to restore this backup.';
                  Alert.alert('Restore failed', message);
                } finally {
                  setSaving(false);
                }
              })();
            },
          },
        ]
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open the backup file.';
      Alert.alert('Restore failed', message);
    }
  }

  async function openHistoryReport(reportDate: string) {
    setLoadingHistoryReport(true);
    setHistoryModalVisible(true);
    setSelectedHistoryReport(null);

    try {
      const report = await getHistoryReport(reportDate);
      setSelectedHistoryReport(report);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open that report.';
      Alert.alert('History failed', message);
      setHistoryModalVisible(false);
    } finally {
      setLoadingHistoryReport(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color="#b24a2c" />
        <Text style={styles.loadingText}>Loading shop counter...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.appShell}>
        <View style={styles.heroCard}>
          <View>
            <Text style={styles.heroEyebrow}>Monginis Daily Sales Counter</Text>
            <Text style={styles.heroTitle}>{formatDateLabel(todayDate)}</Text>
          </View>
          <Pressable style={styles.refreshButton} onPress={() => void loadAppData(false)}>
            <Text style={styles.refreshButtonText}>Refresh</Text>
          </Pressable>
          <View style={styles.heroStatsRow}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>Sold today</Text>
              <Text style={styles.heroStatValue}>{todayReport.totalQuantity}</Text>
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>Items tracked</Text>
              <Text style={styles.heroStatValue}>{items.length}</Text>
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>Active lines</Text>
              <Text style={styles.heroStatValue}>{todayReport.lineCount}</Text>
            </View>
          </View>
        </View>

        <View style={styles.tabRow}>
          {SCREEN_OPTIONS.map((option) => (
            <Pressable
              key={option.key}
              onPress={() => setScreen(option.key)}
              style={[
                styles.tabButton,
                screen === option.key ? styles.tabButtonActive : null,
              ]}
            >
              <Text
                style={[
                  styles.tabButtonText,
                  screen === option.key ? styles.tabButtonTextActive : null,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {screen === 'counter' ? (
          <ScrollView contentContainerStyle={styles.screenContent}>
            <View style={styles.sectionCard}>
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search item name"
                placeholderTextColor="#8f7f72"
                style={styles.searchInput}
              />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterRow}
              >
                {CATEGORY_FILTERS.map((category) => (
                  <Pressable
                    key={category}
                    onPress={() => setSelectedCategory(category)}
                    style={[
                      styles.filterChip,
                      selectedCategory === category ? styles.filterChipActive : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        selectedCategory === category ? styles.filterChipTextActive : null,
                      ]}
                    >
                      {category}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Pressable style={styles.primaryButton} onPress={openAddItemModal}>
                <Text style={styles.primaryButtonText}>Add custom item</Text>
              </Pressable>
            </View>

            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Today’s counter</Text>
                <Text style={styles.sectionHint}>{filteredItems.length} visible</Text>
              </View>

              {filteredItems.length === 0 ? (
                <Text style={styles.emptyStateText}>
                  No items match this search or category.
                </Text>
              ) : (
                filteredItems.map((item) => (
                  <View key={item.id} style={styles.itemCard}>
                    <View style={styles.itemTopRow}>
                      <View style={styles.itemTextBlock}>
                        <Text style={styles.itemName}>{item.name}</Text>
                        <Text style={styles.itemMeta}>
                          {item.category} • {formatPrice(item.price)}
                        </Text>
                      </View>
                      <Pressable
                        style={styles.manageLink}
                        onPress={() => openEditItemModal(item)}
                      >
                        <Text style={styles.manageLinkText}>Manage</Text>
                      </Pressable>
                    </View>

                    <View style={styles.counterRow}>
                      <Pressable
                        style={[styles.counterButton, styles.counterButtonMinus]}
                        onPress={() => void handleQuantityChange(item, item.quantity - 1)}
                      >
                        <Text style={[styles.counterButtonText, styles.counterButtonTextDark]}>-</Text>
                      </Pressable>

                      <Pressable
                        style={styles.quantityPill}
                        onPress={() => openQuantityModal(item)}
                      >
                        <Text style={styles.quantityValue}>{item.quantity}</Text>
                        <Text style={styles.quantityEditHint}>Tap to edit</Text>
                      </Pressable>

                      <Pressable
                        style={[styles.counterButton, styles.counterButtonPlus]}
                        onPress={() => void handleQuantityChange(item, item.quantity + 1)}
                      >
                        <Text style={styles.counterButtonText}>+</Text>
                      </Pressable>
                    </View>
                  </View>
                ))
              )}
            </View>
          </ScrollView>
        ) : null}

        {screen === 'report' ? (
          <ScrollView contentContainerStyle={styles.screenContent}>
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Today’s report</Text>
              <Text style={styles.reportSummary}>
                {todayReport.totalQuantity} total sold across {todayReport.lineCount} items.
              </Text>
              <View style={styles.actionGrid}>
                <Pressable style={styles.secondaryButton} onPress={() => void copyTodayReport()}>
                  <Text style={styles.secondaryButtonText}>Copy text</Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={() => void exportTodayCsv()}>
                  <Text style={styles.secondaryButtonText}>Export CSV</Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={() => void exportTodayPdf()}>
                  <Text style={styles.secondaryButtonText}>Export PDF</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.sectionCard}>
              {todayReport.items.length === 0 ? (
                <Text style={styles.emptyStateText}>
                  No sales recorded yet for today.
                </Text>
              ) : (
                todayReport.items.map((item) => (
                  <View key={item.itemId ?? item.itemName} style={styles.reportRow}>
                    <View style={styles.reportTextBlock}>
                      <Text style={styles.reportItemName}>{item.itemName}</Text>
                      <Text style={styles.reportItemMeta}>{item.category}</Text>
                    </View>
                    <Text style={styles.reportQuantity}>{item.quantity}</Text>
                  </View>
                ))
              )}
            </View>
          </ScrollView>
        ) : null}

        {screen === 'history' ? (
          <ScrollView contentContainerStyle={styles.screenContent}>
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Saved daily reports</Text>
                <Pressable onPress={() => void refreshHistoryOnly()}>
                  <Text style={styles.manageLinkText}>Refresh list</Text>
                </Pressable>
              </View>
              {history.length === 0 ? (
                <Text style={styles.emptyStateText}>
                  History will appear here after the date changes and the app saves the previous day.
                </Text>
              ) : (
                history.map((entry) => (
                  <Pressable
                    key={entry.reportDate}
                    style={styles.historyCard}
                    onPress={() => void openHistoryReport(entry.reportDate)}
                  >
                    <View>
                      <Text style={styles.historyDate}>{formatDateLabel(entry.reportDate)}</Text>
                      <Text style={styles.historyMeta}>{entry.lineCount} items in report</Text>
                    </View>
                    <Text style={styles.historyQuantity}>{entry.totalQuantity}</Text>
                  </Pressable>
                ))
              )}
            </View>
          </ScrollView>
        ) : null}

        {screen === 'backup' ? (
          <ScrollView contentContainerStyle={styles.screenContent}>
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Offline backup</Text>
              <Text style={styles.backupText}>
                Export your items, today’s counts, and saved history into a local JSON file. You can
                restore that file later on the same or another phone.
              </Text>
              <View style={styles.backupButtonStack}>
                <Pressable style={styles.primaryButton} onPress={() => void exportBackupJson()}>
                  <Text style={styles.primaryButtonText}>Create backup file</Text>
                </Pressable>
                <Pressable style={styles.secondaryButtonWide} onPress={() => void restoreBackupJson()}>
                  <Text style={styles.secondaryButtonText}>Restore from backup file</Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>How reset works</Text>
              <Text style={styles.backupText}>
                The app checks the phone’s local date whenever it opens or becomes active. If a new day
                has started, it saves the previous day into history and starts the new day from zero.
              </Text>
            </View>
          </ScrollView>
        ) : null}
      </View>

      <Modal visible={itemModalVisible} transparent animationType="slide" onRequestClose={() => setItemModalVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{editingItem ? 'Edit item' : 'Add custom item'}</Text>

            <Text style={styles.fieldLabel}>Item name</Text>
            <TextInput
              value={itemName}
              onChangeText={setItemName}
              placeholder="Enter item name"
              placeholderTextColor="#8f7f72"
              style={styles.modalInput}
            />

            <Text style={styles.fieldLabel}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {CATEGORY_OPTIONS.map((category) => (
                <Pressable
                  key={category}
                  onPress={() => setItemCategory(category)}
                  style={[
                    styles.filterChip,
                    itemCategory === category ? styles.filterChipActive : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      itemCategory === category ? styles.filterChipTextActive : null,
                    ]}
                  >
                    {category}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={styles.fieldLabel}>Price (optional)</Text>
            <TextInput
              value={itemPrice}
              onChangeText={setItemPrice}
              placeholder="Example: 399"
              placeholderTextColor="#8f7f72"
              keyboardType="decimal-pad"
              style={styles.modalInput}
            />

            <View style={styles.modalButtonRow}>
              <Pressable style={styles.modalGhostButton} onPress={() => setItemModalVisible(false)}>
                <Text style={styles.modalGhostButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalPrimaryButton, saving ? styles.disabledButton : null]}
                onPress={() => void handleItemSubmit()}
                disabled={saving}
              >
                <Text style={styles.modalPrimaryButtonText}>
                  {saving ? 'Saving...' : editingItem ? 'Save changes' : 'Add item'}
                </Text>
              </Pressable>
            </View>

            {editingItem ? (
              <Pressable style={styles.deleteButton} onPress={confirmDeleteCurrentItem}>
                <Text style={styles.deleteButtonText}>Delete this item</Text>
              </Pressable>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={quantityModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setQuantityModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Set exact quantity</Text>
            <Text style={styles.quantityItemName}>{quantityItem?.name}</Text>

            <TextInput
              value={quantityValue}
              onChangeText={setQuantityValue}
              keyboardType="number-pad"
              style={styles.quantityInput}
            />

            <View style={styles.modalButtonRow}>
              <Pressable style={styles.modalGhostButton} onPress={() => setQuantityModalVisible(false)}>
                <Text style={styles.modalGhostButtonText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalPrimaryButton} onPress={() => void saveManualQuantity()}>
                <Text style={styles.modalPrimaryButtonText}>Save quantity</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={historyModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setHistoryModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, styles.historyModalCard]}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.modalTitle}>
                {selectedHistoryReport
                  ? formatDateLabel(selectedHistoryReport.reportDate)
                  : 'Daily report'}
              </Text>
              <Pressable onPress={() => setHistoryModalVisible(false)}>
                <Text style={styles.manageLinkText}>Close</Text>
              </Pressable>
            </View>

            {loadingHistoryReport ? (
              <View style={styles.historyLoadingState}>
                <ActivityIndicator size="small" color="#b24a2c" />
                <Text style={styles.loadingText}>Loading report...</Text>
              </View>
            ) : null}

            {!loadingHistoryReport && selectedHistoryReport ? (
              <ScrollView>
                <Text style={styles.reportSummary}>
                  {selectedHistoryReport.totalQuantity} total sold across {selectedHistoryReport.lineCount} items.
                </Text>
                {selectedHistoryReport.items.map((item) => (
                  <View key={`${item.itemName}-${item.quantity}`} style={styles.reportRow}>
                    <View style={styles.reportTextBlock}>
                      <Text style={styles.reportItemName}>{item.itemName}</Text>
                      <Text style={styles.reportItemMeta}>{item.category}</Text>
                    </View>
                    <Text style={styles.reportQuantity}>{item.quantity}</Text>
                  </View>
                ))}
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f5efe7',
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: '#f5efe7',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#6b5a4d',
    fontSize: 16,
    fontWeight: '600',
  },
  appShell: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 14,
  },
  heroCard: {
    backgroundColor: '#fff7f0',
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: '#ead7c9',
    gap: 14,
  },
  heroEyebrow: {
    color: '#b24a2c',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  heroTitle: {
    color: '#2f261f',
    fontSize: 24,
    fontWeight: '800',
    marginTop: 4,
  },
  refreshButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#f1dfd0',
  },
  refreshButtonText: {
    color: '#7f3f24',
    fontWeight: '700',
  },
  heroStatsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  heroStat: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#f0dfcf',
  },
  heroStatLabel: {
    color: '#8f7f72',
    fontSize: 12,
    marginBottom: 6,
  },
  heroStatValue: {
    color: '#2f261f',
    fontSize: 22,
    fontWeight: '800',
  },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#eadfd2',
    borderRadius: 18,
    padding: 4,
    gap: 4,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 14,
  },
  tabButtonActive: {
    backgroundColor: '#ffffff',
  },
  tabButtonText: {
    color: '#866f60',
    fontWeight: '700',
    fontSize: 13,
  },
  tabButtonTextActive: {
    color: '#b24a2c',
  },
  screenContent: {
    paddingBottom: 36,
    gap: 14,
  },
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: '#ebdfd5',
    gap: 14,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  sectionTitle: {
    color: '#2f261f',
    fontSize: 20,
    fontWeight: '800',
  },
  sectionHint: {
    color: '#8f7f72',
    fontWeight: '600',
  },
  searchInput: {
    backgroundColor: '#faf4ee',
    borderWidth: 1,
    borderColor: '#ead9cc',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#2f261f',
    fontSize: 16,
  },
  filterRow: {
    gap: 10,
    paddingVertical: 2,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#f7efe7',
  },
  filterChipActive: {
    backgroundColor: '#b24a2c',
  },
  filterChipText: {
    color: '#705b4d',
    fontWeight: '700',
  },
  filterChipTextActive: {
    color: '#fff7f0',
  },
  primaryButton: {
    backgroundColor: '#b24a2c',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
  },
  itemCard: {
    borderWidth: 1,
    borderColor: '#efe3d8',
    borderRadius: 20,
    padding: 14,
    gap: 14,
    backgroundColor: '#fffaf5',
  },
  itemTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  itemTextBlock: {
    flex: 1,
    gap: 6,
  },
  itemName: {
    color: '#2f261f',
    fontSize: 18,
    fontWeight: '800',
  },
  itemMeta: {
    color: '#7f6f63',
    fontSize: 13,
    fontWeight: '600',
  },
  manageLink: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#f1dfd0',
  },
  manageLinkText: {
    color: '#a04a2f',
    fontWeight: '700',
  },
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  counterButton: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterButtonMinus: {
    backgroundColor: '#f0ddd1',
  },
  counterButtonPlus: {
    backgroundColor: '#b24a2c',
  },
  counterButtonText: {
    fontSize: 28,
    fontWeight: '900',
    color: '#fff',
  },
  counterButtonTextDark: {
    color: '#6b3c25',
  },
  quantityPill: {
    flex: 1,
    minHeight: 64,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ecdacc',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  quantityValue: {
    color: '#2f261f',
    fontSize: 24,
    fontWeight: '900',
  },
  quantityEditHint: {
    color: '#8f7f72',
    fontSize: 12,
    fontWeight: '600',
  },
  reportSummary: {
    color: '#6d5c50',
    fontSize: 15,
    fontWeight: '600',
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  secondaryButton: {
    flexGrow: 1,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: '#f4e7db',
    alignItems: 'center',
    minWidth: 110,
  },
  secondaryButtonWide: {
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: '#f4e7db',
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#8a4126',
    fontWeight: '800',
  },
  reportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1e4d9',
  },
  reportTextBlock: {
    flex: 1,
    gap: 4,
  },
  reportItemName: {
    color: '#2f261f',
    fontWeight: '700',
    fontSize: 16,
  },
  reportItemMeta: {
    color: '#8f7f72',
    fontSize: 13,
    fontWeight: '600',
  },
  reportQuantity: {
    color: '#b24a2c',
    fontWeight: '900',
    fontSize: 22,
  },
  emptyStateText: {
    color: '#8a7a6d',
    fontSize: 15,
    lineHeight: 22,
  },
  historyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: '#fff8f2',
    borderWidth: 1,
    borderColor: '#f1e4d9',
  },
  historyDate: {
    color: '#2f261f',
    fontWeight: '800',
    fontSize: 16,
  },
  historyMeta: {
    color: '#8f7f72',
    marginTop: 4,
    fontWeight: '600',
  },
  historyQuantity: {
    color: '#b24a2c',
    fontSize: 24,
    fontWeight: '900',
  },
  backupText: {
    color: '#6e5d50',
    fontSize: 15,
    lineHeight: 22,
  },
  backupButtonStack: {
    gap: 10,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(46, 32, 24, 0.36)',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#fffdf9',
    borderRadius: 24,
    padding: 18,
    gap: 14,
  },
  historyModalCard: {
    maxHeight: '75%',
  },
  modalTitle: {
    color: '#2f261f',
    fontSize: 22,
    fontWeight: '800',
  },
  fieldLabel: {
    color: '#6d5c50',
    fontSize: 14,
    fontWeight: '700',
  },
  modalInput: {
    backgroundColor: '#f8f1ea',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ead9cc',
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: '#2f261f',
  },
  modalButtonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modalGhostButton: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#f4e7db',
  },
  modalGhostButtonText: {
    color: '#7f3f24',
    fontWeight: '800',
  },
  modalPrimaryButton: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#b24a2c',
  },
  modalPrimaryButtonText: {
    color: '#fff',
    fontWeight: '800',
  },
  deleteButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  deleteButtonText: {
    color: '#c53929',
    fontWeight: '800',
  },
  disabledButton: {
    opacity: 0.6,
  },
  quantityItemName: {
    color: '#6e5d50',
    fontSize: 15,
    fontWeight: '600',
  },
  quantityInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ead9cc',
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 16,
    fontSize: 28,
    fontWeight: '800',
    color: '#2f261f',
    textAlign: 'center',
  },
  historyLoadingState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    gap: 12,
  },
});
