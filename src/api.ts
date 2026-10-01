// The only module that talks to the Rust backend.
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export interface Item {
  id: string;
  type: string;
  title: string;
  body: string;
  parentId: string | null;
  dueAt: number | null;
  createdAt: number;
  updatedAt: number;
  openedAt: number | null;
}

export interface ItemSummary {
  id: string;
  type: string;
  title: string;
  dueAt: number | null;
  lastActivityAt: number;
}

/** Omitted fields stay unchanged; `dueAt: null` clears the due date. */
export interface ItemPatch {
  title?: string;
  body?: string;
  dueAt?: number | null;
}

/** A row of the dashboard "Hari ini" list. */
export interface DayTask {
  id: string;
  title: string;
  dueAt: number;
  completedAt: number | null;
  overdue: boolean;
}

/** One day of the "7 hari ke depan" card; `date` is the local date, e.g. "2026-10-01". */
export interface UpcomingDay {
  date: string;
  tasks: DayTask[];
}

export type AccountKind = "cash" | "bank" | "ewallet" | "credit";

export interface AccountView {
  id: string;
  name: string;
  kind: AccountKind;
  currency: string;
  openingBalance: number;
  /** Opening balance plus transactions dated up to today. */
  balance: number;
}

/** No `id` creates an account. */
export interface AccountInput {
  id?: string;
  name: string;
  kind: AccountKind;
  openingBalance: number;
}

export interface TransactionView {
  id: string;
  title: string;
  body: string;
  /** Rupiah; negative is money leaving the account. */
  amount: number;
  category: string | null;
  accountId: string;
  accountName: string;
  occurredAt: number;
  createdAt: number;
  transferId: string | null;
  counterAccountId: string | null;
  counterAccountName: string | null;
  billId: string | null;
  /** Dated after today, so not in the balance yet. */
  scheduled: boolean;
}

export type TransactionKind = "expense" | "income";

/** `amount` is always positive; `kind` sets the sign. No `id` creates a transaction. */
export interface TransactionInput {
  id?: string;
  kind: TransactionKind;
  amount: number;
  accountId: string;
  occurredAt: number;
  category?: string;
  title: string;
  body?: string;
}

/** No `transferId` creates a transfer. */
export interface TransferInput {
  transferId?: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  occurredAt: number;
  title?: string;
}

export type Flow = "all" | "in" | "out";

export interface TransactionPage {
  items: TransactionView[];
  more: boolean;
}

export interface Categories {
  expense: string[];
  income: string[];
}

export type BudgetLevel = "ok" | "warn" | "over";

export interface BudgetView {
  amount: number;
  level: BudgetLevel;
}

export interface MonthFlow {
  month: string;
  income: number;
  expense: number;
}

export interface FinanceOverview {
  month: string;
  currentMonth: string;
  balance: number;
  accountCount: number;
  income: number;
  expense: number;
  net: number;
  budget: BudgetView | null;
  /** Six months, oldest first. */
  chart: MonthFlow[];
}

export type Repeat = "once" | "monthly";
export type BillStatus = "overdue" | "dueToday" | "upcoming" | "paidToday";

export interface BillView {
  id: string;
  name: string;
  amount: number;
  accountId: string;
  accountName: string;
  repeat: Repeat;
  dueAt: number;
  status: BillStatus;
  daysLate: number;
}

/** No `id` creates a bill. */
export interface BillInput {
  id?: string;
  name: string;
  amount: number;
  accountId: string;
  repeat: Repeat;
  dueAt: number;
}

/** The dashboard's Keuangan card, the bell and the notification panel. */
export interface FinanceSummary {
  hasAccounts: boolean;
  balance: number;
  /** Spent this month. */
  expense: number;
  budget: BudgetView | null;
  /** Overdue or due today. */
  dueBills: BillView[];
}

export type ProjectKind = "app" | "document" | "research" | "personal";
export type ProjectStatus = "active" | "late" | "done";

export interface ProjectSummary {
  id: string;
  name: string;
  kind: ProjectKind;
  deadlineAt: number | null;
  deadlineDays: number | null;
  status: ProjectStatus;
  done: number;
  total: number;
}

export interface ProjectDetail {
  id: string;
  name: string;
  kind: ProjectKind;
  description: string;
  deadlineAt: number | null;
  deadlineDays: number | null;
  repoUrl: string | null;
  status: ProjectStatus;
  done: number;
  total: number;
}

export interface ProjectInput {
  id?: string;
  name: string;
  kind: ProjectKind;
  deadlineAt?: number | null;
  repoUrl?: string | null;
  description: string;
}

export interface LooseCount {
  done: number;
  total: number;
}

export interface ProjectsOverview {
  projects: ProjectSummary[];
  activeCount: number;
  loose: LooseCount;
  upcoming: TaskCard[];
}

export interface Columns {
  plan: TaskCard[];
  doing: TaskCard[];
  done: TaskCard[];
}

export interface Board {
  project: ProjectDetail | null;
  columns: Columns;
}

export type TaskStatus = "plan" | "doing" | "done";

export interface TaskCard {
  id: string;
  title: string;
  status: TaskStatus;
  tag: string | null;
  dueAt: number | null;
  overdue: boolean;
  subDone: number;
  subTotal: number;
  projectId: string | null;
  projectName: string | null;
}

export interface TaskDetail {
  id: string;
  title: string;
  status: TaskStatus;
  tag: string | null;
  dueAt: number | null;
  overdue: boolean;
  subDone: number;
  subTotal: number;
  projectId: string | null;
  projectName: string | null;
  startAt: number | null;
  parentId: string | null;
  parentTitle: string | null;
  subtasks: TaskCard[];
}

export interface NewTask {
  title: string;
  projectId?: string | null;
  parentId?: string | null;
  status: TaskStatus;
}

export interface TaskPatch {
  status?: TaskStatus;
  projectId?: string | null;
  startAt?: number | null;
  tag?: string | null;
}

export interface Dashboard {
  today: DayTask[];
  upcoming: UpcomingDay[];
  recent: ItemSummary[];
  inboxCount: number;
  finance: FinanceSummary;
  projects: ProjectSummary[];
  habitReminders: HabitReminder[];
}

export type DayState = "blank" | "future" | "off" | "done" | "todo" | "miss";

export interface HabitRow {
  id: string;
  name: string;
  days: number;
  remindAt: string | null;
  remindOn: boolean;
  autoJournal: boolean;
  scheduledToday: boolean;
  doneToday: boolean;
  streak: number;
  best: number;
  rate30: number;
  week: DayState[];
  createdAt: number;
}

export interface TopStreak {
  name: string;
  days: number;
}

export interface Consistency {
  percent: number;
  done: number;
  scheduled: number;
}

export interface HabitsOverview {
  today: string;
  todayDone: number;
  todayTotal: number;
  topStreak: TopStreak | null;
  consistency: Consistency;
  habits: HabitRow[];
}

export interface HistoryCell {
  date: string;
  day: number;
  state: DayState;
}

export interface HabitHistory {
  month: string;
  cells: HistoryCell[];
}

export interface HabitReminder {
  id: string;
  name: string;
  remindAt: string;
}

export interface HabitInput {
  id?: string;
  name: string;
  days: number;
  remindAt?: string | null;
  remindOn: boolean;
  autoJournal?: boolean;
}

export type EntryKind = "idea" | "vent" | "note";

export interface EntrySummary {
  id: string;
  kind: EntryKind;
  title: string;
  preview: string;
  mood: number | null;
  createdAt: number;
  time: string;
}

export interface Entry {
  id: string;
  kind: EntryKind;
  title: string;
  body: string;
  mood: number | null;
  tags: string[];
  createdAt: number;
  when: string;
  taskId: string | null;
}

export interface Group {
  key: string;
  label: string;
  entries: EntrySummary[];
}

export type JournalGroup = Group;

export interface JournalList {
  groups: Group[];
}

export interface ListQuery {
  query?: string;
  kind?: EntryKind;
}

export interface EntryPatch {
  kind?: EntryKind;
  mood?: number | null;
  tags?: string;
}

export interface TrendDay {
  date: string;
  mood: number | null;
  wrote: boolean;
}

export interface Side {
  trend: TrendDay[];
  writeDays: number;
  ideas: EntrySummary[];
}

export type JournalSide = Side;

export interface DbStatus {
  path: string;
  error: string | null;
  backupError: string | null;
}

export interface DataPaths {
  dataDir: string;
  backupDir: string;
  logDir: string;
}

export interface GithubStatus {
  connected: boolean;
  login: string | null;
}

export interface Contributions {
  connected: boolean;
  login: string | null;
  fetchedOn: string | null;
  days: { date: string; count: number }[];
  /** Set when a refresh failed; `days` then holds the last cached data. */
  error: string | null;
}

export type FolderKind = "data" | "backup" | "log";

export type ItemSource = "task" | "bill";
export type ItemKind = "project" | "bill" | "personal";

export interface ScheduleItem {
  key: string;
  source: ItemSource;
  id: string;
  kind: ItemKind;
  title: string;
  groupId: string;
  groupName: string;
  startDate?: string;
  dueDate: string;
  status: TaskStatus;
  overdue: boolean;
  checkable: boolean;
}

export interface ProjectDeadline {
  projectId: string;
  name: string;
  date: string;
}

export interface Schedule {
  today: string;
  items: ScheduleItem[];
  deadlines: ProjectDeadline[];
}

export interface ScheduleRange {
  from: string;
  to: string;
}

export type FileKind = "folder" | "image" | "video" | "pdf" | "text" | "other";
export type PasteMode = "copy" | "move";
export type OnConflict = "replace" | "skip" | "rename";

export interface Place {
  name: string;
  path: string;
  icon: string;
}

export interface FilePlaces {
  places: Place[];
  devices: Place[];
}

export interface FileEntry {
  name: string;
  path: string;
  kind: FileKind;
  size: number;
  modified: number;
  hidden: boolean;
}

export interface Crumb {
  name: string;
  path: string;
}

export interface Listing {
  path: string;
  parent: string | null;
  crumbs: Crumb[];
  entries: FileEntry[];
}

export interface PasteRequest {
  sources: string[];
  dest: string;
  mode: PasteMode;
  onConflict?: OnConflict;
}

export interface FileFailure {
  path: string;
  error: string;
}

export interface OpReport {
  done: string[];
  failed: FileFailure[];
  conflicts: string[];
}

export interface TextPreview {
  text: string;
  truncated: boolean;
}

export type DownloadKind = "media" | "file";
export type DownloadStatus =
  | "queued"
  | "running"
  | "paused"
  | "processing"
  | "done"
  | "failed";

export interface MediaOptions {
  audioOnly: boolean;
  quality: string;
  format: string;
  subtitles: boolean;
}

export interface NewDownload {
  url: string;
  kind: DownloadKind;
  options?: MediaOptions | null;
}

export interface DownloadView {
  id: string;
  title: string;
  url: string;
  kind: DownloadKind;
  options: MediaOptions | null;
  status: DownloadStatus;
  totalBytes: number | null;
  doneBytes: number;
  filePath: string | null;
  error: string | null;
  createdAt: number;
  finishedAt: number | null;
  speed: number | null;
  eta: number | null;
}

export interface DownloadsPayload {
  items: DownloadView[];
  speed: number;
  active: number;
}

export interface YtDlpEngine {
  version: string;
  stale: boolean;
}

export interface FfmpegEngine {
  version: string;
}

export interface EnginesInfo {
  ytdlp: YtDlpEngine | null;
  ffmpeg: FfmpegEngine | null;
  hint: string | null;
}

export interface DownloadSettings {
  dir: string;
  parallel: number;
  limit: number;
}

export const api = {
  dbStatus: () => invoke<DbStatus>("db_status"),
  openFolder: (kind: FolderKind) => invoke<void>("open_folder", { kind }),
  captureNote: (text: string) => invoke<Item>("capture_note", { text }),
  openItem: (id: string) => invoke<Item>("open_item", { id }),
  updateItem: (id: string, patch: ItemPatch) => invoke<Item>("update_item", { id, patch }),
  deleteItem: (id: string) => invoke<void>("delete_item", { id }),
  projectsOverview: () => invoke<ProjectsOverview>("projects_overview"),
  projectBoard: (id: string | null) => invoke<Board>("project_board", { id }),
  saveProject: (input: ProjectInput) => invoke<ProjectDetail>("save_project", { input }),
  deleteProject: (id: string) => invoke<void>("delete_project", { id }),
  openRepo: (id: string) => invoke<void>("open_repo", { id }),
  createTask: (input: NewTask) => invoke<TaskCard>("create_task", { input }),
  getTask: (id: string) => invoke<TaskDetail>("get_task", { id }),
  updateTask: (id: string, patch: TaskPatch) => invoke<TaskDetail>("update_task", { id, patch }),
  deleteTask: (id: string) => invoke<void>("delete_task", { id }),
  convertToTask: (id: string) => invoke<TaskDetail>("convert_to_task", { id }),
  listInbox: () => invoke<ItemSummary[]>("list_inbox"),
  getDashboard: () => invoke<Dashboard>("get_dashboard"),
  listAccounts: () => invoke<AccountView[]>("list_accounts"),
  saveAccount: (input: AccountInput) => invoke<AccountView>("save_account", { input }),
  deleteAccount: (id: string) => invoke<void>("delete_account", { id }),
  listTransactions: (until: string, flow: Flow, offset: number) =>
    invoke<TransactionPage>("list_transactions", { query: { until, flow, offset } }),
  saveTransaction: (input: TransactionInput) => invoke<TransactionView>("save_transaction", { input }),
  saveTransfer: (input: TransferInput) => invoke<TransactionView>("save_transfer", { input }),
  deleteTransaction: (id: string) => invoke<void>("delete_transaction", { id }),
  financeCategories: () => invoke<Categories>("finance_categories"),
  /** `null` is the current month. */
  financeOverview: (month: string | null) => invoke<FinanceOverview>("finance_overview", { month }),
  /** `null` removes the monthly limit. */
  setBudget: (amount: number | null) => invoke<void>("set_budget", { amount }),
  listBills: () => invoke<BillView[]>("list_bills"),
  saveBill: (input: BillInput) => invoke<BillView>("save_bill", { input }),
  /** Returns the recorded expense. */
  payBill: (id: string) => invoke<TransactionView>("pay_bill", { id }),
  deleteBill: (id: string) => invoke<void>("delete_bill", { id }),
  githubStatus: () => invoke<GithubStatus>("github_status"),
  connectGithub: (token: string) => invoke<GithubStatus>("connect_github", { token }),
  disconnectGithub: () => invoke<void>("disconnect_github"),
  getContributions: (force: boolean) => invoke<Contributions>("get_contributions", { force }),
  backupNow: () => invoke<string>("backup_now"),
  schedule: (from: string, to: string) =>
    invoke<Schedule>("schedule", { range: { from, to } }),
  habitsOverview: () => invoke<HabitsOverview>("habits_overview"),
  habitHistory: (id: string, month: string) =>
    invoke<HabitHistory>("habit_history", { id, month }),
  saveHabit: (input: HabitInput) => invoke<HabitRow>("save_habit", { input }),
  deleteHabit: (id: string) => invoke<void>("delete_habit", { id }),
  checkHabit: (id: string, done: boolean) =>
    invoke<HabitRow>("check_habit", { id, done }),
  journalList: (query?: string, kind?: EntryKind) =>
    invoke<JournalList>("journal_list", { query, kind }),
  journalEntry: (id: string) => invoke<Entry>("journal_entry", { id }),
  createEntry: (kind: EntryKind, title?: string) =>
    invoke<Entry>("create_entry", { kind, title }),
  updateEntry: (id: string, patch: EntryPatch) =>
    invoke<Entry>("update_entry", { id, patch }),
  entryToTask: (id: string) => invoke<Entry>("entry_to_task", { id }),
  journalSide: () => invoke<Side>("journal_side"),
  dataPaths: () => invoke<DataPaths>("data_paths"),
  filePlaces: () => invoke<FilePlaces>("file_places"),
  listDir: (path: string, hidden: boolean) =>
    invoke<Listing>("list_dir", { path, hidden }),
  readText: (path: string) => invoke<TextPreview>("read_text", { path }),
  pasteItems: (req: PasteRequest) =>
    invoke<OpReport>("paste_items", { req }),
  trashItems: (paths: string[]) =>
    invoke<OpReport>("trash_items", { paths }),
  openFile: (path: string) => invoke<void>("open_file", { path }),
  downloadsList: () => invoke<DownloadsPayload>("downloads_list"),
  addDownload: (input: NewDownload) =>
    invoke<DownloadView>("add_download", { input }),
  pauseDownload: (id: string) => invoke<void>("pause_download", { id }),
  resumeDownload: (id: string) => invoke<void>("resume_download", { id }),
  retryDownload: (id: string) => invoke<void>("retry_download", { id }),
  removeDownload: (id: string) => invoke<void>("remove_download", { id }),
  openDownload: (id: string) => invoke<void>("open_download", { id }),
  revealDownload: (id: string) => invoke<string>("reveal_download", { id }),
  downloadEngines: () => invoke<EnginesInfo>("download_engines"),
  downloadSettings: () => invoke<DownloadSettings>("download_settings"),
  saveDownloadSettings: (settings: DownloadSettings) =>
    invoke<DownloadSettings>("save_download_settings", { settings }),
};

/** Convert a local absolute path to an asset:// URL for <img>, <video>, <iframe>. */
export function assetUrl(path: string): string {
  // Component tests render to static markup without the Tauri runtime.
  if (typeof window === "undefined") {
    return `asset://localhost/${encodeURIComponent(path)}`;
  }
  return convertFileSrc(path);
}

/** Backend errors arrive as `{ code, message }`. */
export function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return String(error);
}
