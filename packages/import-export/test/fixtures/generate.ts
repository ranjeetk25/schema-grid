import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const here = dirname(fileURLToPath(import.meta.url));

export const GENERATED_DIR = join(here, "generated");
export const SAMPLE_XLSX = join(GENERATED_DIR, "sample.xlsx");

/** Writes the binary XLSX fixtures used by the parse tests (gitignored). */
export async function generateFixtures(): Promise<void> {
  await mkdir(GENERATED_DIR, { recursive: true });

  const wb = new ExcelJS.Workbook();

  const leads = wb.addWorksheet("Leads");
  leads.addRow([
    "Amount",
    "Float",
    "Date",
    "DateTime",
    "Flag",
    "Formula",
    "Link",
    "Rich",
    "Error",
    "Blank",
  ]);
  const row2 = leads.getRow(2);
  row2.getCell(1).value = 1234.5;
  row2.getCell(1).numFmt = "#,##0.00";
  row2.getCell(2).value = 0.1 + 0.2;
  row2.getCell(3).value = new Date(Date.UTC(2026, 8, 25));
  row2.getCell(3).numFmt = "yyyy-mm-dd";
  row2.getCell(4).value = new Date(Date.UTC(2026, 8, 25, 10, 30));
  row2.getCell(4).numFmt = "yyyy-mm-dd hh:mm";
  row2.getCell(5).value = true;
  row2.getCell(6).value = { formula: "A2*2", result: 2469 };
  row2.getCell(7).value = { text: "Masai", hyperlink: "https://masaischool.com" };
  row2.getCell(8).value = {
    richText: [{ text: "Hello " }, { text: "World", font: { bold: true } }],
  };
  row2.getCell(9).value = { error: "#N/A" };
  row2.commit();
  // Rows 3-6: simple data so maxRows truncation can be exercised.
  for (let i = 3; i <= 6; i++) {
    leads.getRow(i).getCell(1).value = i * 100;
    leads.getRow(i).getCell(2).value = `row ${i}`;
  }

  const offset = wb.addWorksheet("Offset");
  offset.addRow(["Quarterly leads report"]);
  offset.addRow(["Name", "Email", "Score"]);
  offset.addRow(["Asha", "asha@example.com", 91]);
  offset.addRow(["Ravi", "ravi@example.com", 78]);

  await wb.xlsx.writeFile(SAMPLE_XLSX);
}
