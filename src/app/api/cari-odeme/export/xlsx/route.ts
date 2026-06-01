import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import type { Payment } from "@/lib/cari-odeme/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body: { rows: any[]; title: string; columns?: Partial<ExcelJS.Column>[] } = await req.json();
    const { rows, title, columns } = body;

    if (!rows || !Array.isArray(rows)) {
      return NextResponse.json({ ok: false, reason: "Geçersiz veri." }, { status: 400 });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Cari Ödeme";
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet(title || "Sayfa 1");

    const useCustom = Array.isArray(columns) && columns.length > 0;
    worksheet.columns = useCustom
      ? (columns as ExcelJS.Column[])
      : [
          { header: "Talep Eden", key: "requesterName", width: 25 },
          { header: "Firma", key: "companyName", width: 30 },
          { header: "Açıklama", key: "description", width: 40 },
          { header: "Tutar", key: "amount", width: 15, style: { numFmt: '#,##0.00 "TRY"' } },
          { header: "Vade Tarihi", key: "dueDate", width: 15, style: { numFmt: "dd.mm.yyyy" } },
          { header: "Fatura No", key: "invoiceNo", width: 20 },
          { header: "Banka", key: "bankName", width: 25 },
          { header: "Durum", key: "status", width: 15 },
          { header: "Oluşturulma Tarihi", key: "createdAt", width: 20, style: { numFmt: "dd.mm.yyyy ss:mm" } },
        ] as ExcelJS.Column[];

    worksheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF16A34A" } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });

    if (useCustom) {
      rows.forEach((r) => worksheet.addRow(r));
    } else {
      (rows as Payment[]).forEach((payment) => {
        worksheet.addRow({
          ...payment,
          dueDate: new Date(payment.dueDate),
          createdAt: new Date(payment.createdAt),
          status:
            ({ pending: "Beklemede", approved: "Onaylandı", paid: "Ödendi", rejected: "Reddedildi" } as Record<string, string>)[
              payment.status
            ] || payment.status,
        });
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(buffer as any, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="odemeler.xlsx"',
      },
    });
  } catch (error) {
    console.error("Excel generation error:", error);
    return NextResponse.json({ ok: false, reason: "xlsx generation failed" }, { status: 500 });
  }
}
