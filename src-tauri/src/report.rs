//! Monthly and yearly Keuangan recap, exported as a real PDF (spec Fase 2 §5).
//!
//! The document is written directly with `pdf-writer` and uses the PDF base-14
//! fonts (Helvetica, Courier, WinAnsi), so it embeds nothing and opens in any
//! viewer. Amounts stay integer rupiah until they are formatted here, with the
//! same grouping as the frontend's `formatRupiah`.
use std::io::Write;
use std::path::{Path, PathBuf};

use jiff::Timestamp;
use jiff::tz::TimeZone;
use pdf_writer::{Content, Name, Pdf, Rect, Ref, Str};
use rusqlite::{Connection, params};
use serde::Deserialize;
use tauri::State;

use crate::db::Db;
use crate::error::AppError;
use crate::finance::{self, invalid};
use crate::overview;
use crate::time::{add_months, first_day, indonesian_long_month, indonesian_short_month, local_date, month_bounds, now_ms};

/// Which recap the user asked for. `monthly` takes a `YYYY-MM` period,
/// `yearly` a `YYYY` one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RecapKind {
    Monthly,
    Yearly,
}

/// One bar pair of the cash-flow chart: a day (monthly) or a month (yearly).
#[derive(Debug, Clone, PartialEq)]
pub struct Bucket {
    pub label: String,
    pub income: i64,
    pub expense: i64,
}

/// One expense category and its total for the period.
#[derive(Debug, Clone, PartialEq)]
pub struct CategoryTotal {
    pub name: String,
    pub amount: i64,
}

/// Everything the PDF shows, already aggregated.
#[derive(Debug, Clone, PartialEq)]
pub struct Recap {
    pub heading: String,
    pub period: String,
    pub income: i64,
    pub expense: i64,
    pub net: i64,
    pub balance: i64,
    pub count: i64,
    pub buckets: Vec<Bucket>,
    pub categories: Vec<CategoryTotal>,
}

impl Recap {
    /// A period with no transactions still gets a valid PDF, with this state.
    pub fn empty(&self) -> bool {
        self.count == 0
    }
}

// ---------- aggregation ----------

/// Aggregates one month or one year from the existing finance queries. Income
/// and expense come from `overview::month_flow`, so transfers stay out of both;
/// the closing balance counts transactions up to the period end, or up to
/// today for a period still running, so later and scheduled money stays out.
pub fn recap(conn: &Connection, kind: RecapKind, period: &str, now: i64, tz: &TimeZone) -> Result<Recap, AppError> {
    let (heading, label, start, end, buckets, income, expense) = match kind {
        RecapKind::Monthly => {
            let (start, end) = month_bounds(period, tz)?;
            let flow = overview::month_flow(conn, period, tz)?;
            let date = first_day(period)?;
            let label = format!("{} {}", indonesian_long_month(date.month()), date.year());
            ("Rekap Bulanan", label, start, end, daily_buckets(conn, start, end, tz)?, flow.income, flow.expense)
        }
        RecapKind::Yearly => {
            let year = year_of(period)?;
            let january = format!("{year:04}-01");
            let start = month_bounds(&january, tz)?.0;
            let end = month_bounds(&add_months(&january, 12)?, tz)?.0;
            let mut buckets = Vec::with_capacity(12);
            let mut totals = (0_i128, 0_i128);
            for month in 1..=12_i8 {
                let flow = overview::month_flow(conn, &format!("{year:04}-{month:02}"), tz)?;
                totals = (totals.0 + i128::from(flow.income), totals.1 + i128::from(flow.expense));
                buckets.push(Bucket { label: indonesian_short_month(month).into(), income: flow.income, expense: flow.expense });
            }
            let income = small(totals.0)?;
            let expense = small(totals.1)?;
            ("Rekap Tahunan", format!("{year:04}"), start, end, buckets, income, expense)
        }
    };
    let accounts = finance::list_accounts_before(conn, end.min(finance::balance_cutoff(now, tz)?))?;
    Ok(Recap {
        heading: heading.into(),
        period: label,
        income,
        expense,
        net: income.checked_sub(expense).ok_or_else(out_of_range)?,
        balance: finance::total_balance(&accounts)?,
        count: count_transactions(conn, start, end)?,
        buckets,
        categories: expense_categories(conn, start, end)?,
    })
}

fn year_of(period: &str) -> Result<i32, AppError> {
    if period.len() != 4 || !period.bytes().all(|b| b.is_ascii_digit()) {
        return Err(invalid("Periode tahun harus YYYY"));
    }
    period.parse::<i32>().map_err(|_| invalid("Periode tahun harus YYYY"))
}

fn out_of_range() -> AppError {
    invalid("Total di luar batas bilangan bulat")
}

fn small(value: i128) -> Result<i64, AppError> {
    i64::try_from(value).map_err(|_| out_of_range())
}

/// Income and expense of every local day of the period, as chart bars.
fn daily_buckets(conn: &Connection, start: i64, end: i64, tz: &TimeZone) -> Result<Vec<Bucket>, AppError> {
    let last = local_date(end - 1, tz)?.day() as usize;
    let mut buckets: Vec<Bucket> =
        (1..=last).map(|day| Bucket { label: day.to_string(), income: 0, expense: 0 }).collect();
    let mut stmt = conn.prepare(
        "SELECT t.occurred_at, t.amount FROM transactions t JOIN items i ON i.id = t.item_id
         WHERE i.deleted_at IS NULL AND t.transfer_id IS NULL AND t.occurred_at >= ?1 AND t.occurred_at < ?2",
    )?;
    let rows = stmt.query_map(params![start, end], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?;
    for row in rows {
        let (at, amount) = row?;
        let day = Timestamp::from_millisecond(at)?.to_zoned(tz.clone()).day() as usize;
        let bucket = buckets.get_mut(day - 1).ok_or_else(|| invalid("Tanggal di luar periode"))?;
        let slot = if amount > 0 { &mut bucket.income } else { &mut bucket.expense };
        let delta = i64::try_from(amount.unsigned_abs()).map_err(|_| out_of_range())?;
        *slot = slot.checked_add(delta).ok_or_else(out_of_range)?;
    }
    Ok(buckets)
}

fn count_transactions(conn: &Connection, start: i64, end: i64) -> Result<i64, AppError> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM transactions t JOIN items i ON i.id = t.item_id
         WHERE i.deleted_at IS NULL AND t.transfer_id IS NULL AND t.occurred_at >= ?1 AND t.occurred_at < ?2",
        params![start, end],
        |r| r.get(0),
    )?)
}

/// Expenses grouped by category, biggest first. A missing category is grouped
/// under "Tanpa kategori" so nothing is silently dropped.
fn expense_categories(conn: &Connection, start: i64, end: i64) -> Result<Vec<CategoryTotal>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT COALESCE(NULLIF(TRIM(t.category), ''), 'Tanpa kategori') AS name, -SUM(t.amount) AS total
         FROM transactions t JOIN items i ON i.id = t.item_id
         WHERE i.deleted_at IS NULL AND t.transfer_id IS NULL AND t.amount < 0
           AND t.occurred_at >= ?1 AND t.occurred_at < ?2
         GROUP BY name ORDER BY total DESC, name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map(params![start, end], |r| Ok(CategoryTotal { name: r.get(0)?, amount: r.get(1)? }))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

// ---------- formatting (matches the frontend's `formatRupiah`) ----------

/// 25000 → "Rp 25.000"; -25000 → "-Rp 25.000". Whole rupiah, "." thousands.
pub fn rupiah(amount: i64) -> String {
    format!("{}Rp {}", if amount < 0 { "-" } else { "" }, grouped(amount.unsigned_abs()))
}

/// 1 → "1", 25000 → "25.000".
pub fn grouped(value: u64) -> String {
    let digits = value.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push('.');
        }
        out.push(c);
    }
    out
}

/// 65000 of 80000 → "81,2%". Indonesian decimal comma.
pub fn share(part: i64, total: i64) -> String {
    if total <= 0 {
        return "0,0%".into();
    }
    let per_mille = (i128::from(part) * 1000 / i128::from(total)) as i64;
    format!("{},{}%", per_mille / 10, per_mille % 10)
}

/// "6 Oktober 2026 14:30", the moment the file was written.
fn generated_label(now: i64, tz: &TimeZone) -> Result<String, AppError> {
    let zoned = Timestamp::from_millisecond(now)?.to_zoned(tz.clone());
    Ok(format!(
        "{} {} {} {:02}.{:02}",
        zoned.day(),
        indonesian_long_month(zoned.month()),
        zoned.year(),
        zoned.hour(),
        zoned.minute()
    ))
}

// ---------- PDF ----------

const PAGE_W: f32 = 595.28;
const PAGE_H: f32 = 841.89;
const MARGIN: f32 = 48.0;
/// Rows the category table has room for on the single page.
const TABLE_ROWS: usize = 8;

type Rgb = (f32, f32, f32);

const INK: Rgb = (0.10, 0.12, 0.16);
const MUTED: Rgb = (0.45, 0.48, 0.53);
const HAIRLINE: Rgb = (0.84, 0.86, 0.89);
const AXIS: Rgb = (0.62, 0.65, 0.69);
const INCOME: Rgb = (0.10, 0.55, 0.36);
const EXPENSE: Rgb = (0.80, 0.24, 0.24);
const PALETTE: [Rgb; 8] = [
    (0.29, 0.44, 0.78),
    (0.90, 0.49, 0.13),
    (0.10, 0.55, 0.36),
    (0.80, 0.24, 0.24),
    (0.55, 0.35, 0.75),
    (0.15, 0.62, 0.65),
    (0.85, 0.70, 0.12),
    (0.45, 0.50, 0.58),
];

#[derive(Clone, Copy)]
enum Font {
    Regular,
    Bold,
    Mono,
}

impl Font {
    fn name(self) -> Name<'static> {
        match self {
            Font::Regular => Name(b"F1"),
            Font::Bold => Name(b"FB"),
            Font::Mono => Name(b"F3"),
        }
    }
}

/// Encodes text for the WinAnsiEncoding base-14 fonts (Windows-1252). A
/// character the encoding cannot draw, emoji, CJK or a control, becomes '?'.
fn win_ansi(value: &str) -> Vec<u8> {
    value
        .chars()
        .map(|ch| match ch {
            ' '..='~' | '\u{A0}'..='\u{FF}' => ch as u8,
            '€' => 0x80,
            '‚' => 0x82,
            'ƒ' => 0x83,
            '„' => 0x84,
            '…' => 0x85,
            '†' => 0x86,
            '‡' => 0x87,
            'ˆ' => 0x88,
            '‰' => 0x89,
            'Š' => 0x8A,
            '‹' => 0x8B,
            'Œ' => 0x8C,
            'Ž' => 0x8E,
            '\u{2018}' => 0x91,
            '\u{2019}' => 0x92,
            '“' => 0x93,
            '”' => 0x94,
            '•' => 0x95,
            '–' => 0x96,
            '—' => 0x97,
            '˜' => 0x98,
            '™' => 0x99,
            'š' => 0x9A,
            '›' => 0x9B,
            'œ' => 0x9C,
            'ž' => 0x9E,
            'Ÿ' => 0x9F,
            _ => b'?',
        })
        .collect()
}

fn text(c: &mut Content, x: f32, y: f32, size: f32, color: Rgb, font: Font, value: &str) {
    c.begin_text();
    c.set_fill_rgb(color.0, color.1, color.2);
    c.set_font(font.name(), size);
    c.next_line(x, y);
    c.show(Str(&win_ansi(value)));
    c.end_text();
}

/// Courier advances exactly 600/1000 em, so a right edge is exact arithmetic.
fn mono_right(c: &mut Content, right: f32, y: f32, size: f32, color: Rgb, value: &str) {
    let width = value.chars().count() as f32 * 0.6 * size;
    text(c, right - width, y, size, color, Font::Mono, value);
}

fn fill_rect(c: &mut Content, x: f32, y: f32, w: f32, h: f32, color: Rgb) {
    c.set_fill_rgb(color.0, color.1, color.2);
    c.rect(x, y, w, h);
    c.fill_nonzero();
}

fn hairline(c: &mut Content, x1: f32, y1: f32, x2: f32, y2: f32) {
    c.set_stroke_rgb(HAIRLINE.0, HAIRLINE.1, HAIRLINE.2);
    c.set_line_width(0.5);
    c.move_to(x1, y1);
    c.line_to(x2, y2);
    c.stroke();
}

/// Renders the whole recap into PDF bytes.
pub fn render_pdf(recap: &Recap, generated: &str) -> Result<Vec<u8>, AppError> {
    let mut c = Content::new();
    draw_header(&mut c, recap, generated);
    draw_summary(&mut c, recap);
    if recap.empty() {
        text(&mut c, MARGIN, 700.0, 11.0, MUTED, Font::Regular, "Tidak ada transaksi pada periode ini.");
    } else {
        draw_cash_flow(&mut c, recap);
        let rows = display_rows(recap)?;
        draw_categories(&mut c, &rows, recap.expense);
        draw_table(&mut c, &rows, recap.expense);
    }
    text(&mut c, MARGIN, 22.0, 8.0, MUTED, Font::Regular, "Dibuat dengan Anchoa");

    let stream = c.finish();
    let (catalog, pages, page, contents) = (Ref::new(1), Ref::new(2), Ref::new(3), Ref::new(4));
    let (regular, bold, mono) = (Ref::new(5), Ref::new(6), Ref::new(7));

    let mut pdf = Pdf::new();
    pdf.catalog(catalog).pages(pages);
    pdf.pages(pages).kids([page]).count(1);
    {
        let mut p = pdf.page(page);
        p.parent(pages).media_box(Rect::new(0.0, 0.0, PAGE_W, PAGE_H));
        p.contents(contents);
        p.resources().fonts().pair(Name(b"F1"), regular).pair(Name(b"FB"), bold).pair(Name(b"F3"), mono);
    }
    pdf.type1_font(regular).base_font(Name(b"Helvetica")).encoding_predefined(Name(b"WinAnsiEncoding"));
    pdf.type1_font(bold).base_font(Name(b"Helvetica-Bold")).encoding_predefined(Name(b"WinAnsiEncoding"));
    pdf.type1_font(mono).base_font(Name(b"Courier")).encoding_predefined(Name(b"WinAnsiEncoding"));
    pdf.stream(contents, &stream);
    Ok(pdf.finish())
}

fn draw_header(c: &mut Content, recap: &Recap, generated: &str) {
    text(c, MARGIN, 800.0, 19.0, INK, Font::Bold, &recap.heading);
    text(c, MARGIN, 780.0, 11.0, INK, Font::Regular, &format!("Periode: {}", recap.period));
    text(c, MARGIN, 764.0, 9.0, MUTED, Font::Regular, &format!("Dibuat: {generated}"));
}

fn draw_summary(c: &mut Content, recap: &Recap) {
    text(c, MARGIN, 738.0, 12.5, INK, Font::Bold, "Ringkasan");
    let rows = [
        ("Total pemasukan", rupiah(recap.income)),
        ("Total pengeluaran", rupiah(recap.expense)),
        ("Selisih", rupiah(recap.net)),
        ("Saldo akhir", rupiah(recap.balance)),
        ("Jumlah transaksi", grouped(recap.count.unsigned_abs())),
    ];
    for (i, (label, value)) in rows.iter().enumerate() {
        let y = 720.0 - i as f32 * 18.0;
        text(c, MARGIN, y, 10.5, INK, Font::Regular, label);
        mono_right(c, PAGE_W - MARGIN, y, 10.5, INK, value);
    }
}

fn draw_cash_flow(c: &mut Content, recap: &Recap) {
    text(c, MARGIN, 618.0, 12.5, INK, Font::Bold, "Arus Kas");
    let (x0, y0, w, h) = (100.0, 440.0, PAGE_W - MARGIN - 100.0, 150.0);
    let max = recap.buckets.iter().flat_map(|b| [b.income, b.expense]).max().unwrap_or(0);
    for step in 0..=4 {
        hairline(c, x0, y0 + h * step as f32 / 4.0, x0 + w, y0 + h * step as f32 / 4.0);
    }
    c.set_stroke_rgb(AXIS.0, AXIS.1, AXIS.2);
    c.set_line_width(0.8);
    c.move_to(x0, y0);
    c.line_to(x0 + w, y0);
    c.stroke();
    fill_rect(c, x0, y0 + h + 8.0, 7.0, 7.0, INCOME);
    text(c, x0 + 11.0, y0 + h + 9.0, 8.0, MUTED, Font::Regular, "Pemasukan");
    fill_rect(c, x0 + 90.0, y0 + h + 8.0, 7.0, 7.0, EXPENSE);
    text(c, x0 + 101.0, y0 + h + 9.0, 8.0, MUTED, Font::Regular, "Pengeluaran");
    mono_right(c, x0 + w, y0 + h + 9.0, 8.0, MUTED, &format!("Skala maks {}", rupiah(max)));
    if max <= 0 {
        return;
    }
    let count = recap.buckets.len();
    let slot = w / count as f32;
    let bar = (slot * 0.3).min(12.0);
    for (i, bucket) in recap.buckets.iter().enumerate() {
        let center = x0 + slot * (i as f32 + 0.5);
        let height = |value: i64| h * (value as f32 / max as f32);
        if bucket.income > 0 {
            fill_rect(c, center - bar - 0.8, y0, bar, height(bucket.income), INCOME);
        }
        if bucket.expense > 0 {
            fill_rect(c, center + 0.8, y0, bar, height(bucket.expense), EXPENSE);
        }
    }
    let step = (count as f32 / 12.0).ceil().max(1.0) as usize;
    for (i, bucket) in recap.buckets.iter().enumerate() {
        if i % step == 0 || i + 1 == count {
            text(c, x0 + slot * (i as f32 + 0.5) - 4.0, y0 - 10.0, 7.0, MUTED, Font::Regular, &bucket.label);
        }
    }
}

/// Top slices plus one "Lainnya" bucket, so the pie and the table stay legible.
fn display_rows(recap: &Recap) -> Result<Vec<(String, i64)>, AppError> {
    if recap.categories.len() <= TABLE_ROWS {
        return Ok(recap.categories.iter().map(|c| (c.name.clone(), c.amount)).collect());
    }
    let head = &recap.categories[..TABLE_ROWS - 1];
    let rest = recap.categories[TABLE_ROWS - 1..].iter().try_fold(0_i128, |sum, c| sum.checked_add(i128::from(c.amount)));
    let rest = small(rest.ok_or_else(out_of_range)?)?;
    let mut rows: Vec<(String, i64)> = head.iter().map(|c| (c.name.clone(), c.amount)).collect();
    rows.push((format!("Lainnya ({} kategori)", recap.categories.len() - (TABLE_ROWS - 1)), rest));
    Ok(rows)
}

fn draw_categories(c: &mut Content, rows: &[(String, i64)], expense: i64) {
    text(c, MARGIN, 400.0, 12.5, INK, Font::Bold, "Pengeluaran per Kategori");
    let (cx, cy, r) = (150.0, 300.0, 72.0);
    let mut angle = 90.0_f32;
    for (i, (_, amount)) in rows.iter().enumerate() {
        let sweep = -360.0 * (*amount as f32 / expense as f32);
        let color = PALETTE[i % PALETTE.len()];
        let steps = ((sweep.abs() / 4.0).ceil() as usize).max(2);
        c.set_fill_rgb(color.0, color.1, color.2);
        c.move_to(cx, cy);
        for step in 0..=steps {
            let theta = (angle + sweep * step as f32 / steps as f32).to_radians();
            c.line_to(cx + r * theta.cos(), cy + r * theta.sin());
        }
        c.close_path();
        c.fill_nonzero();
        angle += sweep;
    }
    for (i, (name, amount)) in rows.iter().enumerate() {
        let y = 366.0 - i as f32 * 17.0;
        fill_rect(c, 280.0, y, 8.0, 8.0, PALETTE[i % PALETTE.len()]);
        text(c, 293.0, y + 0.5, 9.0, INK, Font::Regular, &format!("{name} - {} ({})", rupiah(*amount), share(*amount, expense)));
    }
}

fn draw_table(c: &mut Content, rows: &[(String, i64)], expense: i64) {
    text(c, MARGIN, 196.0, 12.5, INK, Font::Bold, "Rincian Kategori");
    let (amount_x, share_x) = (430.0, PAGE_W - MARGIN);
    text(c, MARGIN, 176.0, 9.5, MUTED, Font::Bold, "Kategori");
    mono_right(c, amount_x, 176.0, 9.5, MUTED, "Jumlah");
    mono_right(c, share_x, 176.0, 9.5, MUTED, "Bagian");
    hairline(c, MARGIN, 170.0, PAGE_W - MARGIN, 170.0);
    for (i, (name, amount)) in rows.iter().enumerate() {
        let y = 152.0 - i as f32 * 15.5;
        text(c, MARGIN, y, 10.0, INK, Font::Regular, name);
        mono_right(c, amount_x, y, 10.0, INK, &rupiah(*amount));
        mono_right(c, share_x, y, 10.0, INK, &share(*amount, expense));
    }
    hairline(c, MARGIN, 38.0, PAGE_W - MARGIN, 38.0);
}

// ---------- file + command ----------

/// Writes `<dir>/rekap-bulanan-2026-10.pdf` (or `rekap-tahunan-2026.pdf`) and
/// returns the path. An existing name gets `-2`, `-3`, … like the journal export.
pub fn write_recap_pdf(
    conn: &Connection,
    dir: &Path,
    kind: RecapKind,
    period: &str,
    now: i64,
    tz: &TimeZone,
) -> Result<PathBuf, AppError> {
    let data = recap(conn, kind, period, now, tz)?;
    let bytes = render_pdf(&data, &generated_label(now, tz)?)?;
    std::fs::create_dir_all(dir)?;
    let stem = match kind {
        RecapKind::Monthly => format!("rekap-bulanan-{period}"),
        RecapKind::Yearly => format!("rekap-tahunan-{period}"),
    };
    let mut path = dir.join(format!("{stem}.pdf"));
    let mut counter = 2;
    let mut file = loop {
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => break file,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                path = dir.join(format!("{stem}-{counter}.pdf"));
                counter += 1;
            }
            Err(e) => return Err(e.into()),
        }
    };
    file.write_all(&bytes)?;
    Ok(path)
}

/// Registered by the parent in `lib.rs` as `report::finance_recap_pdf`.
#[tauri::command]
pub fn finance_recap_pdf(db: State<'_, Db>, dir: String, kind: RecapKind, period: String) -> Result<String, AppError> {
    let path = write_recap_pdf(&*db.conn()?, Path::new(&dir), kind, &period, now_ms(), &TimeZone::system())?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::finance::testing::{account, earn, jakarta, ms, now, spend, transfer};

    /// A moment inside October, so the closing balance includes that month.
    fn end_of_october() -> i64 {
        ms("2026-10-31T12:00:00+07:00")
    }

    fn text_of(pdf: &[u8]) -> String {
        String::from_utf8_lossy(pdf).into_owned()
    }

    #[test]
    fn monthly_recap_aggregates_days_categories_and_transfers() {
        let conn = open_in_memory();
        let tz = jakarta();
        let bca = account(&conn, "BCA", 500_000);
        let cash = account(&conn, "Tunai", 0);
        earn(&conn, &bca, 1_000_000, "2026-10-01T08:00:00+07:00");
        spend(&conn, &bca, 25_000, "Makan & minum", "2026-10-02T09:00:00+07:00");
        spend(&conn, &bca, 15_000, "Transportasi", "2026-10-02T10:00:00+07:00");
        spend(&conn, &bca, 40_000, "Makan & minum", "2026-10-31T23:00:00+07:00");
        transfer(&conn, &bca, &cash, 500_000, "2026-10-03T00:00:00+07:00");
        let gone = spend(&conn, &bca, 9_999, "Belanja", "2026-10-04T00:00:00+07:00");
        crate::finance::delete_transaction(&conn, &gone.id, now(), &tz).unwrap();
        spend(&conn, &bca, 7_000, "Belanja", "2026-11-01T00:00:00+07:00");
        spend(&conn, &bca, 5_000, "Belanja", "2026-09-30T00:00:00+07:00");

        let r = recap(&conn, RecapKind::Monthly, "2026-10", end_of_october(), &tz).unwrap();

        assert_eq!((r.income, r.expense, r.net, r.count), (1_000_000, 80_000, 920_000, 4));
        assert_eq!(r.balance, 1_415_000);
        assert_eq!((r.heading.as_str(), r.period.as_str()), ("Rekap Bulanan", "Oktober 2026"));
        assert_eq!(r.buckets.len(), 31);
        assert_eq!((r.buckets[0].income, r.buckets[0].expense), (1_000_000, 0));
        assert_eq!((r.buckets[1].income, r.buckets[1].expense), (0, 40_000));
        assert_eq!((r.buckets[30].income, r.buckets[30].expense), (0, 40_000));
        assert_eq!(
            r.categories,
            vec![
                CategoryTotal { name: "Makan & minum".into(), amount: 65_000 },
                CategoryTotal { name: "Transportasi".into(), amount: 15_000 },
            ]
        );
        assert!(!r.empty());
        let flow = overview::month_flow(&conn, "2026-10", &tz).unwrap();
        assert_eq!((flow.income, flow.expense), (r.income, r.expense));
    }

    #[test]
    fn yearly_recap_buckets_by_month() {
        let conn = open_in_memory();
        let tz = jakarta();
        let bca = account(&conn, "BCA", 0);
        earn(&conn, &bca, 100_000, "2026-01-15T08:00:00+07:00");
        spend(&conn, &bca, 30_000, "Tagihan", "2026-06-10T09:00:00+07:00");
        spend(&conn, &bca, 20_000, "Belanja", "2026-12-31T20:00:00+07:00");
        spend(&conn, &bca, 1_000, "Belanja", "2025-12-31T20:00:00+07:00");
        earn(&conn, &bca, 5_000, "2027-01-01T08:00:00+07:00");

        let r = recap(&conn, RecapKind::Yearly, "2026", ms("2026-12-31T12:00:00+07:00"), &tz).unwrap();

        assert_eq!((r.heading.as_str(), r.period.as_str()), ("Rekap Tahunan", "2026"));
        assert_eq!((r.income, r.expense, r.count), (100_000, 50_000, 3));
        assert_eq!(r.buckets.len(), 12);
        assert_eq!((r.buckets[0].label.as_str(), r.buckets[11].label.as_str()), ("Jan", "Des"));
        assert_eq!((r.buckets[0].income, r.buckets[5].expense, r.buckets[11].expense), (100_000, 30_000, 20_000));
        assert_eq!(overview::month_flow(&conn, "2026-06", &tz).unwrap().expense, 30_000);
        assert_eq!(r.categories.len(), 2);
    }

    #[test]
    fn empty_period_still_renders_a_valid_pdf() {
        let conn = open_in_memory();
        let tz = jakarta();

        let r = recap(&conn, RecapKind::Monthly, "2026-10", now(), &tz).unwrap();
        assert!(r.empty());
        assert_eq!((r.income, r.expense, r.net, r.count, r.balance), (0, 0, 0, 0, 0));

        let pdf = render_pdf(&r, "6 Oktober 2026 14:30").unwrap();
        let text = text_of(&pdf);
        assert!(pdf.starts_with(b"%PDF"));
        assert!(text.contains("Rekap Bulanan"));
        assert!(text.contains("Oktober 2026"));
        assert!(text.contains("Tidak ada transaksi pada periode ini"));
        assert!(text.contains("%%EOF"));
    }

    #[test]
    fn rupiah_and_share_match_the_frontend_formatting() {
        assert_eq!(rupiah(0), "Rp 0");
        assert_eq!(rupiah(999), "Rp 999");
        assert_eq!(rupiah(25_000), "Rp 25.000");
        assert_eq!(rupiah(1_234_567), "Rp 1.234.567");
        assert_eq!(rupiah(-25_000), "-Rp 25.000");
        assert_eq!(rupiah(9_007_199_254_740_991), "Rp 9.007.199.254.740.991");
        assert_eq!(grouped(1_420_000), "1.420.000");
        assert_eq!(share(65_000, 80_000), "81,2%");
        assert_eq!(share(1, 3), "33,3%");
        assert_eq!(share(80_000, 80_000), "100,0%");
        assert_eq!(share(0, 0), "0,0%");
    }

    #[test]
    fn written_pdf_has_summary_charts_and_the_category_table() {
        let conn = open_in_memory();
        let tz = jakarta();
        let bca = account(&conn, "BCA", 0);
        earn(&conn, &bca, 1_000_000, "2026-10-01T08:00:00+07:00");
        spend(&conn, &bca, 25_000, "Makan & minum", "2026-10-02T09:00:00+07:00");
        let dir = tempfile::tempdir().unwrap();

        let first = write_recap_pdf(&conn, dir.path(), RecapKind::Monthly, "2026-10", end_of_october(), &tz).unwrap();
        let second = write_recap_pdf(&conn, dir.path(), RecapKind::Monthly, "2026-10", end_of_october(), &tz).unwrap();

        assert_eq!(first.file_name().unwrap(), "rekap-bulanan-2026-10.pdf");
        assert_eq!(second.file_name().unwrap(), "rekap-bulanan-2026-10-2.pdf");
        let bytes = std::fs::read(&first).unwrap();
        let text = text_of(&bytes);
        assert!(bytes.starts_with(b"%PDF"));
        assert!(text.contains("Rekap Bulanan"));
        assert!(text.contains("Periode: Oktober 2026"));
        assert!(text.contains("Total pemasukan"));
        assert!(text.contains("Total pengeluaran"));
        assert!(text.contains("Selisih"));
        assert!(text.contains("Saldo akhir"));
        assert!(text.contains("Jumlah transaksi"));
        assert!(text.contains("Rp 1.000.000"));
        assert!(text.contains("Rp 25.000"));
        assert!(text.contains("Arus Kas"));
        assert!(text.contains("Pengeluaran per Kategori"));
        assert!(text.contains("Rincian Kategori"));
        assert!(text.contains("Makan & minum"));
        assert!(text.contains("100,0%"));
        assert!(text.contains("%%EOF"));
    }

    #[test]
    fn a_bad_period_is_invalid() {
        let conn = open_in_memory();
        let tz = jakarta();
        for bad in ["2026-13", "2026", "", "abcd-01", "2026-9"] {
            assert!(matches!(recap(&conn, RecapKind::Monthly, bad, now(), &tz), Err(AppError::Invalid(_))), "{bad}");
        }
        for bad in ["26", "abcd", "", "2026-01", " 2026"] {
            assert!(matches!(recap(&conn, RecapKind::Yearly, bad, now(), &tz), Err(AppError::Invalid(_))), "{bad}");
        }
    }

    #[test]
    fn many_categories_fold_into_one_others_row() {
        let conn = open_in_memory();
        let tz = jakarta();
        let bca = account(&conn, "BCA", 0);
        for i in 1_i64..=10 {
            spend(&conn, &bca, i * 1_000, &format!("Kategori {i:02}"), "2026-10-05T09:00:00+07:00");
        }
        let r = recap(&conn, RecapKind::Monthly, "2026-10", end_of_october(), &tz).unwrap();
        let rows = display_rows(&r).unwrap();
        assert_eq!(rows.len(), TABLE_ROWS);
        assert_eq!(rows[7].0, "Lainnya (3 kategori)");
        assert_eq!(rows[7].1, 1_000 + 2_000 + 3_000);
        let pdf = render_pdf(&r, "6 Oktober 2026 14:30").unwrap();
        assert!(text_of(&pdf).contains("Lainnya (3 kategori)"));
    }

    #[test]
    fn uncategorized_expenses_are_grouped_and_deleted_rows_are_ignored() {
        let conn = open_in_memory();
        let tz = jakarta();
        let bca = account(&conn, "BCA", 0);
        let plain = spend(&conn, &bca, 5_000, "Belanja", "2026-10-05T09:00:00+07:00");
        conn.execute("UPDATE transactions SET category = NULL WHERE item_id = ?1", [&plain.id]).unwrap();
        let gone = spend(&conn, &bca, 7_000, "Hiburan", "2026-10-06T09:00:00+07:00");
        crate::finance::delete_transaction(&conn, &gone.id, now(), &tz).unwrap();

        let r = recap(&conn, RecapKind::Monthly, "2026-10", end_of_october(), &tz).unwrap();

        assert_eq!(r.categories, vec![CategoryTotal { name: "Tanpa kategori".into(), amount: 5_000 }]);
        assert_eq!(r.count, 1);
    }

    #[test]
    fn closing_balance_stops_at_the_period_end_or_today() {
        let conn = open_in_memory();
        let tz = jakarta();
        let bca = account(&conn, "BCA", 100_000);
        earn(&conn, &bca, 50_000, "2026-08-15T08:00:00+07:00");
        spend(&conn, &bca, 20_000, "Belanja", "2026-08-31T23:59:00+07:00");
        spend(&conn, &bca, 30_000, "Belanja", "2026-09-01T00:00:00+07:00");
        earn(&conn, &bca, 7_000, "2026-09-30T08:00:00+07:00");

        let august = recap(&conn, RecapKind::Monthly, "2026-08", now(), &tz).unwrap();
        assert_eq!(august.balance, 130_000, "September money is not August's closing balance");
        let september = recap(&conn, RecapKind::Monthly, "2026-09", now(), &tz).unwrap();
        assert_eq!(september.balance, 100_000, "scheduled money after today stays out");
        let year = recap(&conn, RecapKind::Yearly, "2026", now(), &tz).unwrap();
        assert_eq!(year.balance, 100_000);
        let last_year = recap(&conn, RecapKind::Yearly, "2025", now(), &tz).unwrap();
        assert_eq!(last_year.balance, 100_000, "only the opening balance before any transaction");
    }

    #[test]
    fn pdf_text_is_encoded_as_win_ansi() {
        assert_eq!(win_ansi("Rp 25.000"), b"Rp 25.000");
        assert_eq!(win_ansi("Kafé – €5 “ok”"), b"Kaf\xe9 \x96 \x805 \x93ok\x94");
        assert_eq!(win_ansi("Teh ☕ 茶\tx"), b"Teh ? ??x");

        let conn = open_in_memory();
        let tz = jakarta();
        let bca = account(&conn, "BCA", 0);
        spend(&conn, &bca, 5_000, "Kafé", "2026-10-05T09:00:00+07:00");
        let r = recap(&conn, RecapKind::Monthly, "2026-10", end_of_october(), &tz).unwrap();
        let pdf = render_pdf(&r, "6 Oktober 2026 14:30").unwrap();
        // pdf-writer writes non-ASCII strings as hex: "Kafé" is 4B 61 66 E9 in WinAnsi.
        let text = text_of(&pdf);
        assert!(text.contains("<4B6166E9>"), "category drawn in WinAnsi");
        assert!(!text.contains("4B6166C3A9"), "no raw UTF-8 in the content stream");
    }
}
