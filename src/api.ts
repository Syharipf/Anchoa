// The only module that talks to the Rust backend.
import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";

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

export interface PageNode {
  id: string;
  title: string;
  parentId: string | null;
  updatedAt: number;
}

export interface TrashEntry {
  id: string;
  title: string;
  deletedAt: number;
  descendants: number;
}

export type SearchHit = ItemSummary & { snippet: string };

export type Backlink = ItemSummary & { excerpt: string };

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
  agent: boolean;
  agentCommand: string | null;
  agentDir: string | null;
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
  agent?: boolean;
  agentCommand?: string | null;
  agentDir?: string | null;
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
  test: TaskCard[];
  review: TaskCard[];
  done: TaskCard[];
}

export interface Board {
  project: ProjectDetail | null;
  columns: Columns;
}

export type TaskStatus = "plan" | "doing" | "test" | "review" | "done";

export type ActivityRole = "request" | "plan" | "implement" | "test" | "review" | "merge" | "note";
export type ActivityKind = "message" | "status" | "result" | "link";

export interface LastActor {
  actor: string;
  role: ActivityRole;
}

export interface Activity {
  id: string;
  taskId: string | null;
  projectId: string;
  actor: string;
  role: ActivityRole;
  kind: ActivityKind;
  title: string;
  body: string;
  createdAt: number;
}

export interface NewActivity {
  taskId?: string | null;
  projectId: string;
  actor: string;
  role: ActivityRole;
  kind: ActivityKind;
  title: string;
  body: string;
}

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
  downloads: DownloadsSummary;
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
  pinned: boolean;
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

export interface JournalFilter {
  query?: string;
  kind?: EntryKind;
  tag?: string;
  mood?: number;
}

export interface EntryPatch {
  kind?: EntryKind;
  mood?: number | null;
  tags?: string;
  pinned?: boolean;
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

export interface Profile {
  name: string;
  since: number | null;
  stats: ProfileStats;
}

export interface ProfileStats {
  habitStreak: number;
  tasksDone: number;
  journalEntries: number;
  notes: number;
}

export interface NotifyPrefs {
  task: boolean;
  bill: boolean;
  budget: boolean;
  habit: boolean;
}

export interface SecurityStatus {
  pinEnabled: boolean;
  locked: boolean;
}

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

export interface TypeCount {
  kind: string;
  count: number;
}

export interface BackupFile {
  name: string;
  bytes: number;
  modifiedAt: number;
}

export interface DataOverview {
  dataDir: string;
  dbBytes: number;
  walBytes: number;
  counts: TypeCount[];
  trashed: number;
  backups: BackupFile[];
}

export interface UpdateCheck {
  current: string;
  latest: string;
  newer: boolean;
  url: string;
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

export interface DownloadSummaryRow {
  id: string;
  title: string;
  progress: number;
  doneBytes: number;
  totalBytes: number | null;
  speed: number | null;
  eta: number | null;
  status: DownloadStatus;
}

export interface DownloadsSummary {
  speed: number;
  items: DownloadSummaryRow[];
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

export type AiRole = "chat" | "journal" | "recap" | "email";

export interface RoleConfig {
  provider: "ollama";
  model: string;
}

export type AiRoles = Record<AiRole, RoleConfig>;

export interface AiStatus {
  available: boolean;
  models: string[];
  error: string | null;
}

export interface AssistantToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** OpenAI message shape; the optional fields keep their wire names. */
export interface AssistantMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: AssistantToolCall[];
  tool_call_id?: string;
}

export type AssistantWriteTool = "create_task" | "complete_task" | "add_transaction" | "add_journal_entry" | "check_habit";

export interface AssistantProposal {
  id: string;
  summary: string;
  name: AssistantWriteTool;
  args: Record<string, unknown>;
}

export type AssistantEvent =
  | { type: "delta"; data: string }
  | { type: "proposal"; data: AssistantProposal }
  | { type: "done"; data: AssistantMessage }
  | { type: "error"; data: string };

export interface AssistantReply {
  message: AssistantMessage;
  proposals: AssistantProposal[];
}

export type AssistantDecision = TaskCard | TaskDetail | TransactionView | Entry | HabitRow | null;

/** Piper controls; Rust clamps to 0.8–1.3, 0.3–0.9, and 0.5–1.0. */
export interface VoiceParams {
  lengthScale: number;
  noiseScale: number;
  noiseW: number;
}

export interface VoiceSettings {
  id: string;
  params: VoiceParams;
}

export interface Voice {
  id: string;
  label: string;
  language: string;
  quality: string;
  installed: boolean;
  imported: boolean;
  params: VoiceParams;
}

export interface VoiceStatus {
  pwRecord: boolean;
  pwPlay: boolean;
  whisper: string | null;
  whisperModel: boolean;
  piper: boolean;
  voices: Voice[];
  settings: VoiceSettings;
  recording: boolean;
  speaking: boolean;
}

export type VoiceComponent = "whisper-model" | "piper" | `voice:${string}`;

export interface VoiceInstallProgress {
  component: VoiceComponent;
  file: string;
  doneBytes: number;
  totalBytes: number | null;
  stage: "downloading" | "verified" | "installed";
}

export type EmailFolder = "inbox" | "starred" | "sent";
export type EmailFilter = "all" | "unread";
export type EmailFlag = "seen" | "starred";

export interface EmailStatus {
  connected: boolean;
  address: string | null;
}

export interface EmailMessage {
  id: string;
  folder: string;
  uid: number;
  subject: string;
  /** Plain text only, including when the source MIME part was HTML. */
  body: string;
  messageId: string | null;
  fromName: string;
  fromAddr: string;
  toAddrs: string[];
  sentAt: number;
  unread: boolean;
  starred: boolean;
  hasHtml: boolean;
  bodyCached: boolean;
}

export interface EmailDraft {
  to: string[];
  subject: string;
  body: string;
  replyToId?: string | null;
}

export interface EmailSyncResult {
  headers: number;
}

export interface EmailAssistance {
  summary: string[];
  replies: string[];
  action: AssistantProposal | null;
}

export type SyncProvider = "google" | "github";

export interface SyncStatus {
  /** False in builds without a Supabase URL and key: every other sync command then fails. */
  configured: boolean;
  signedIn: boolean;
  email: string | null;
  lastSyncAt: number | null;
  lastError: string | null;
  bytesUsed: number;
  quotaBytes: number;
  needsUnlockKey: boolean;
  /** While a key is needed: whether the cloud already has one (unlock) or not (create). Null when unknown. */
  vaultExists: boolean | null;
}

export interface SyncReport {
  pulled: number;
  pushed: number;
  pending: number;
  bytesUsed: number;
  quotaBytes: number;
  stoppedByQuota: boolean;
}

/** Runs the handler after a sync applied records from other devices, so pages can reload. */
export const onSyncChanged = (handler: () => void) => listen("sync-changed", () => handler());

export const api = {
  syncStatus: () => invoke<SyncStatus>("sync_status"),
  /** Opens the browser and resolves when the login completes; reject after `syncCancelSignIn`. */
  syncSignIn: (provider: SyncProvider) => invoke<void>("sync_sign_in", { provider }),
  syncCancelSignIn: () => invoke<void>("sync_cancel_sign_in"),
  /** The recovery key is returned once and never stored. */
  syncCreateKey: (passphrase: string) => invoke<{ recoveryKey: string }>("sync_create_key", { passphrase }),
  syncUnlockKey: (passphraseOrRecovery: string) => invoke<void>("sync_unlock_key", { passphraseOrRecovery }),
  syncChangePassphrase: (oldPassphrase: string, newPassphrase: string) =>
    invoke<void>("sync_change_passphrase", { old: oldPassphrase, new: newPassphrase }),
  syncNow: () => invoke<SyncReport>("sync_now"),
  syncSignOut: (deleteCloud: boolean) => invoke<void>("sync_sign_out", { deleteCloud }),
  emailAssist: (id: string) => invoke<EmailAssistance>("email_assist", { id }),
  emailStatus: () => invoke<EmailStatus>("email_status"),
  emailConnect: (address: string, appPassword: string) =>
    invoke<EmailStatus>("email_connect", { address, appPassword }),
  emailDisconnect: () => invoke<void>("email_disconnect"),
  emailSync: () => invoke<EmailSyncResult>("email_sync"),
  emailList: (folder: EmailFolder, filter: EmailFilter = "all", limit = 200) =>
    invoke<EmailMessage[]>("email_list", { folder, filter, limit }),
  emailOpen: (id: string) => invoke<EmailMessage>("email_open", { id }),
  emailSetFlag: (id: string, flag: EmailFlag, on: boolean) =>
    invoke<void>("email_set_flag", { id, flag, on }),
  emailArchive: (id: string) => invoke<void>("email_archive", { id }),
  emailSend: (draft: EmailDraft) => invoke<void>("email_send", { draft }),
  voiceStatus: () => invoke<VoiceStatus>("voice_status"),
  voiceInstall: (component: VoiceComponent, onEvent: (event: VoiceInstallProgress) => void = () => {}) => {
    const channel = new Channel<VoiceInstallProgress>();
    channel.onmessage = onEvent;
    return invoke<void>("voice_install", { component, onEvent: channel });
  },
  voiceRecordStart: () => invoke<void>("voice_record_start"),
  voiceRecordStop: () => invoke<string>("voice_record_stop"),
  voiceVoices: () => invoke<Voice[]>("voice_voices"),
  voiceImport: (onnxPath: string) => invoke<string>("voice_import", { onnxPath }),
  /** Omitting params restores this voice's saved controls or Piper defaults. */
  setVoice: (id: string, params?: VoiceParams) => invoke<VoiceSettings>("set_voice", { id, params }),
  voiceSpeak: (text: string) => invoke<void>("voice_speak", { text }),
  voiceStop: () => invoke<void>("voice_stop"),
  /** Native file picker for a Piper voice; the matching .onnx.json must sit next to the file. */
  pickVoiceModel: async (): Promise<string | null> => {
    const path = await openFileDialog({ multiple: false, directory: false, filters: [{ name: "Suara Piper", extensions: ["onnx"] }] });
    return typeof path === "string" ? path : null;
  },
  assistantSend: (text: string, onEvent: (event: AssistantEvent) => void) => {
    const channel = new Channel<AssistantEvent>();
    channel.onmessage = onEvent;
    return invoke<AssistantReply>("assistant_send", { text, onEvent: channel });
  },
  assistantStop: () => invoke<void>("assistant_stop"),
  assistantDecide: (id: string, approve: boolean) => invoke<AssistantDecision>("assistant_decide", { id, approve }),
  assistantPending: () => invoke<AssistantProposal[]>("assistant_pending"),
  assistantReset: () => invoke<void>("assistant_reset"),
  aiStatus: () => invoke<AiStatus>("ai_status"),
  aiRoles: () => invoke<AiRoles>("ai_roles"),
  setAiRole: (role: AiRole, provider: RoleConfig["provider"], model: string) =>
    invoke<RoleConfig>("set_ai_role", { role, provider, model }),
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
  agentRequest: (projectId: string, text: string) => invoke<TaskCard>("agent_request", { projectId, text }),
  agentStop: (projectId: string) => invoke<void>("agent_stop", { projectId }),
  agentRunning: () => invoke<string[]>("agent_running"),
  agentLastActors: (projectId: string) => invoke<Record<string, LastActor>>("agent_last_actors", { projectId }),
  taskActivities: (taskId: string) => invoke<Activity[]>("task_activities", { taskId }),
  projectActivities: (projectId: string, limit = 200) =>
    invoke<Activity[]>("project_activities", { projectId, limit }),
  addActivity: (input: NewActivity) => invoke<Activity>("add_activity", { input }),
  agentLog: (taskId: string) => invoke<string>("agent_log", { taskId }),
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
  dataOverview: () => invoke<DataOverview>("data_overview"),
  checkUpdate: () => invoke<UpdateCheck>("check_update"),
  schedule: (from: string, to: string) =>
    invoke<Schedule>("schedule", { range: { from, to } }),
  getProfile: () => invoke<Profile>("get_profile"),
  setProfileName: (name: string) => invoke<Profile>("set_profile_name", { name }),
  getNotifyPrefs: () => invoke<NotifyPrefs>("get_notify_prefs"),
  setNotifyPrefs: (prefs: NotifyPrefs) => invoke<NotifyPrefs>("set_notify_prefs", { prefs }),
  habitsOverview: () => invoke<HabitsOverview>("habits_overview"),
  habitHistory: (id: string, month: string) =>
    invoke<HabitHistory>("habit_history", { id, month }),
  saveHabit: (input: HabitInput) => invoke<HabitRow>("save_habit", { input }),
  deleteHabit: (id: string) => invoke<void>("delete_habit", { id }),
  checkHabit: (id: string, done: boolean) =>
    invoke<HabitRow>("check_habit", { id, done }),
  journalList: (f: JournalFilter = {}) =>
    invoke<JournalList>("journal_list", { query: f.query, kind: f.kind, tag: f.tag, mood: f.mood }),
  journalEntry: (id: string) => invoke<Entry>("journal_entry", { id }),
  createEntry: (kind: EntryKind, title?: string) =>
    invoke<Entry>("create_entry", { kind, title }),
  updateEntry: (id: string, patch: EntryPatch) =>
    invoke<Entry>("update_entry", { id, patch }),
  deleteEntry: (id: string) => invoke<void>("delete_entry", { id }),
  restoreEntry: (id: string) => invoke<void>("restore_entry", { id }),
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
  pagesTree: () => invoke<PageNode[]>("pages_tree"),
  createPage: (parentId: string | null, title: string) =>
    invoke<PageNode>("create_page", { parentId, title }),
  renamePage: (id: string, title: string) =>
    invoke<PageNode>("rename_page", { id, title }),
  movePage: (id: string, parentId: string | null) =>
    invoke<PageNode>("move_page", { id, parentId }),
  savePageBody: (id: string, body: string) =>
    invoke<void>("save_page_body", { id, body }),
  deletePage: (id: string) => invoke<void>("delete_page", { id }),
  pagesTrash: () => invoke<TrashEntry[]>("pages_trash"),
  restorePage: (id: string) => invoke<PageNode>("restore_page", { id }),
  pageBacklinks: (id: string) =>
    invoke<Backlink[]>("page_backlinks", { id }),
  resolveLink: (title: string) =>
    invoke<ItemSummary | null>("resolve_link", { title }),
  searchItems: (text: string, pagesOnly: boolean, limit: number) =>
    invoke<SearchHit[]>("search_items", { text, pagesOnly, limit }),
  exportPages: () => invoke<string>("export_pages"),
  openLink: (url: string) => invoke<void>("open_link", { url }),
  securityStatus: () => invoke<SecurityStatus>("security_status"),
  unlock: (pin: string) => invoke<void>("unlock", { pin }),
  setPin: (oldPin: string | null | undefined, newPin: string) =>
    invoke<void>("set_pin", { old: oldPin ?? null, new: newPin }),
  disablePin: (pin: string) => invoke<void>("disable_pin", { pin }),
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
