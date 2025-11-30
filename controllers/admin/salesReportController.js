const Status=require('../../constants/statusCodes')
const PDFDocument = require("pdfkit");
const ExcelJS = require('exceljs')
const Order=require('../../models/orderSchema')


const getSalesReportPage=async (req,res)=>{
    try {
        return res.render('admin/sales report/sales report',{
          layout:"adminLayout",
          title:"Sales Report",
        })
    } catch (error) {
        console.log("getSalesReportPage() error=======>",error)
        res.redirect("/admin/page-error")
    }
}





// 🧮 Common function to build report data
async function getReportData(type, start, end) {
  const match = { orderStatus: "Delivered" };

  const startDate = new Date(start);
  const endDate = new Date(end);

  // set endDate to 23:59:59.999
  endDate.setHours(23, 59, 59, 999);


  if (start && end) {
    match.deliveredOn = { $gte: startDate, $lte: endDate };
  }

  let groupStage = {};
  if (type === "daily") {
    groupStage = {
      _id: {
        year: { $year: "$deliveredOn" },
        month: { $month: "$deliveredOn" },
        day: { $dayOfMonth: "$deliveredOn" },
      },
    };
  } else if (type === "weekly") {
    groupStage = {
      _id: {
        year: { $year: "$deliveredOn" },
        week: { $week: "$deliveredOn" },
      },
    };
  } else if (type === "yearly") {
    groupStage = {
      _id: { year: { $year: "$deliveredOn" } },
    };
  } else if (start && end) {
    groupStage = { _id: null };
  }

    groupStage.totalOrders = { $sum: 1 };
    groupStage.totalOfferDiscount = {$sum: "$finalTotalOfferDiscount"}
    groupStage.totalCouponDiscount ={$sum: "$finalTotalCouponDiscount"};
    groupStage.totalSales = { $sum: "$finalTotalAmount" };
    groupStage.avgOrderValue = { $avg: "$finalTotalAmount" };

  const report = await Order.aggregate([
    { $match: match },
    { $group: groupStage },
    { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
  ]);


  let totalOrdersCount=0,totalOfferDiscount=0, totalCouponDiscount=0, totalIncome=0;
  report.forEach((r)=>{
    totalOrdersCount+=r.totalOrders;
    totalIncome+=r.totalSales;
    totalOfferDiscount+=r.totalOfferDiscount;
    totalCouponDiscount+=r.totalCouponDiscount;
  })

  return {report, totalOrdersCount, totalOfferDiscount, totalCouponDiscount, totalIncome};
}





const getSalesReport=async (req,res)=>{
    try {
        const {type, start, end} = req.query;

        const {
          report, 
          totalOrdersCount, 
          totalOfferDiscount, 
          totalCouponDiscount,
          totalIncome
        }=await getReportData(type,start,end)

        return res.json({
          report,
          totalOrdersCount,
          totalOfferDiscount,
          totalCouponDiscount,
          totalIncome
        })
    } catch (error) {
        console.log("getSalesReport() error=======>",error)
        res.redirect("/admin/page-error")
    }
}





const getSalesReportPDF = async (req,res)=>{
    try {

        const { type, start, end } = req.query;
        // const {report} = await getReportData(type, start, end);
        const {
          report, 
          totalOrdersCount, 
          totalOfferDiscount, 
          totalCouponDiscount,
          totalIncome
        }=await getReportData(type,start,end)

        const doc = new PDFDocument({ margin: 40 });
        const filename = "sales_report.pdf";

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        doc.pipe(res);

        // 🔹 Header Section
        doc
        .fontSize(22)
        .fillColor("#2E86C1")
        .text("TeeSpace Sales Report", { align: "center" })
        .moveDown(0.5);

        doc
        .fontSize(14)
        .fillColor("black")
        .text(`Report Type: ${type || "Custom Range"}`, { align: "center" })
        .text(`Date Range: ${start || "N/A"} → ${end || "N/A"}`, { align: "center" })
        .text(`Generated On: ${new Date().toLocaleString()}`, { align: "center" })
        .moveDown(1.5);

        doc.moveTo(40, doc.y).lineTo(550, doc.y).stroke("#ccc").moveDown(1.5);

        // 🔹 Table Header
        const headerY = doc.y;
        doc
        .fontSize(11)
        .fillColor("#1A5276")
        .font("Helvetica-Bold")
        .text("Period", 40, headerY)
        .text("Total Orders", 130, headerY)
        .text("Total Sales (₹)", 210, headerY)
        .text("Offer Discount (₹)", 310, headerY)
        .text("Coupon Discount (₹)", 410, headerY)
        .text("Avg Order Value (₹)", 520, headerY, { align: "right" });

        doc.moveDown(0.4);
        doc.moveTo(40, doc.y).lineTo(550, doc.y).stroke("#bbb");

        // 🔹 Table Body
        doc.moveDown(0.4);
        doc.font("Helvetica").fillColor("black");

        report.forEach((r, i) => {
        let label = "";
        if (r._id?.day) label = `${r._id.day}-${r._id.month}-${r._id.year}`;
        else if (r._id?.week) label = `Week ${r._id.week}, ${r._id.year}`;
        else if (r._id?.year) label = `${r._id.year}`;
        else label = `${start} → ${end}`;

        const y = doc.y + 4;

        // Optional: alternate row background color
        if (i % 2 === 0) {
            doc
            .rect(38, y - 3, 512, 18)
            .fill("#f9f9f9")
            .fillColor("black");
        }

        
        doc.text(label, 40, y, { width: 80, ellipsis: true });
        doc.text(`${r.totalOrders}`, 130, y);
        doc.text(`₹${r.totalSales.toFixed(2)}`, 210, y);
        doc.text(`₹${r.totalOfferDiscount.toFixed(2)}`, 310, y);
        doc.text(`₹${r.totalCouponDiscount.toFixed(2)}`, 410, y);
        doc.text(`₹${r.avgOrderValue?.toFixed(2) || "-"}`, 520, y, { align: "right" });


        doc.moveDown(0.5);
        });

        doc.moveDown(1);
        doc.moveTo(40, doc.y).lineTo(550, doc.y).stroke("#ccc");

        // 🔹 Totals Section
        doc.moveDown(1.5);

        doc.fontSize(12).font("Helvetica-Bold").fillColor("#000");
        doc.text("Summary Totals", 40);  // start at left edge

        doc.moveDown(0.5);
        doc.font("Helvetica");

        doc.text(`Total Orders: ${totalOrdersCount}`, 40);
        doc.text(`Total Offer Discount: ₹${totalOfferDiscount.toFixed(2)}`, 40);
        doc.text(`Total Coupon Discount:  ₹${totalCouponDiscount.toFixed(2)}`, 40);
        doc.text(`Total Income:          ₹${totalIncome.toFixed(2)}`, 40);



        // 🔹 Footer
        doc.moveDown(2);
        doc
        .fontSize(10)
        .fillColor("#555")
        .text("Generated by TeeSpace Admin Dashboard", { align: "center" })
        .text("Confidential – For internal use only", { align: "center" });

        doc.end();
    } catch (error) {
        console.log("getSalesReportPDF() error===========>",error);
        res.status(Status.INTERNAL_ERROR).json({message:"PDF generation failed"})
    }
}





const getSalesReportExcel = async (req,res)=>{
    try {
        const { type, start, end } = req.query;
        // const {report} = await getReportData(type, start, end);
        const {
          report, 
          totalOrdersCount, 
          totalOfferDiscount, 
          totalCouponDiscount,
          totalIncome
        }=await getReportData(type,start,end)

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("TeeSpace Sales Report");

        sheet.columns = [
        { header: "Period", key: "period", width: 25 },
        { header: "Total Orders", key: "totalOrders", width: 15 },
        { header: "Total Sales (₹)", key: "totalSales", width: 20 },
        { header: "Average Order Value (₹)", key: "avgOrderValue", width: 25 },
        { header: "Total Offer Discount (₹)", key: "totalOfferDiscount", width: 20 },
        { header: "Total Coupon Discount (₹)", key: "totalCouponDiscount", width: 20 },
        ];

        report.forEach((r) => {
        let label = "";
        if (r._id?.day)
            label = `${r._id.day}-${r._id.month}-${r._id.year}`;
        else if (r._id?.week)
            label = `Week ${r._id.week}, ${r._id.year}`;
        else if (r._id?.year)
            label = `${r._id.year}`;
        else label = `${start} to ${end}`;

          sheet.addRow({
              period: label,
              totalOrders: r.totalOrders,
              totalSales: r.totalSales,
              avgOrderValue: r.avgOrderValue ? r.avgOrderValue.toFixed(2) : "-",
              totalOfferDiscount: r.totalOfferDiscount,
              totalCouponDiscount: r.totalCouponDiscount
          });
        });

        // Add an empty row
        sheet.addRow([]);

        // Summary Header
        const summaryHeader = sheet.addRow(["Summary Totals"]);
        summaryHeader.font = { bold: true, size: 14 };
        summaryHeader.alignment = { horizontal: "left" };

        // Summary Rows
        sheet.addRow(["Total Orders", totalOrdersCount]);
        sheet.addRow(["Total Offer Discount (₹)", totalOfferDiscount.toFixed(2)]);
        sheet.addRow(["Total Coupon Discount (₹)", totalCouponDiscount.toFixed(2)]);
        sheet.addRow(["Total Income (₹)", totalIncome.toFixed(2)]);



        res.setHeader(
        "Content-Disposition",
        `attachment; filename="sales_report.xlsx"`
        );
        res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.log("getSalesReportExcel() error===========>",error);
    }
}


module.exports={
    getSalesReportPage,
    getSalesReport,
    getSalesReportPDF,
    getSalesReportExcel

}