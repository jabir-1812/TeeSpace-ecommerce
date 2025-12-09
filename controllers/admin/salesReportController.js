const Status=require('../../constants/statusCodes')
const PDFDocument = require("pdfkit");
const ExcelJS = require('exceljs')
const Order=require('../../models/orderSchema')
const Product=require('../../models/productSchema');
// const { default: orders } = require('razorpay/dist/types/orders');


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
    groupStage.totalOfferDiscount = {$sum: "$finalTotalOfferDiscount"};//net total offer discount
    groupStage.totalCouponDiscount ={$sum: "$finalTotalCouponDiscount"};//net total coupon discount
    groupStage.totalSales = { $sum: "$finalTotalAmount" };//net total amount
    groupStage.avgOrderValue = { $avg: "$finalTotalAmount" };//net avg of total amount

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


  //retreiving each products's sold count
    const lookupPipeline = [
        { $unwind: "$orderItems" },

        {
            $match: {
            $expr: {
                $and: [
                { $eq: ["$orderItems.productId", "$$productId"] },

                // EXCLUDE RETURNED ITEMS
                {
                    $or: [
                    { $eq: ["$orderItems.refundStatus", null] },
                    { $eq: ["$orderItems.refundStatus", ""] },
                    { $not: [{ $ifNull: ["$orderItems.refundStatus", true] }] }
                    ]
                },

                ...(start && end
                    ? [
                        { $gte: ["$orderItems.deliveredOn", startDate] },
                        { $lte: ["$orderItems.deliveredOn", endDate] }
                    ]
                    : [])
                ]
            }
            }
        },

        {
            $group: {
            _id: null,
            soldQty: { $sum: "$orderItems.quantity" }
            }
        }
    ];

	const productSoldCounts = await Product.aggregate([
		{
			$lookup: {
			from: "orders",
			let: { productId: "$_id" },
			pipeline: lookupPipeline,
			as: "sales"
			}
		},
		{
			$addFields: {
			    soldCount: { $ifNull: [{ $arrayElemAt: ["$sales.soldQty", 0] }, 0] }
			}
		},

		// 🔵 CATEGORY LOOKUP
		{
			$lookup: {
			from: "categories",           // collection name
			localField: "category",       // product.category
			foreignField: "_id",
			as: "categoryDetails"
			}
		},
		{ $unwind: { path: "$categoryDetails", preserveNullAndEmptyArrays: true }},

		// 🔴 BRAND LOOKUP
		{
			$lookup: {
			from: "brands",               // collection name
			localField: "brand",
			foreignField: "_id",
			as: "brandDetails"
			}
		},
		{ $unwind: { path: "$brandDetails", preserveNullAndEmptyArrays: true }},

		// Remove the raw sales lookup
		{ $project: { sales: 0 } },

		// FINAL OUTPUT
		{
			$project: {
			productName: 1,
			productImage: 1,
			soldCount: 1,
			_id: 1,
			category: "$categoryDetails.name",
			brand: "$brandDetails.brandName"
			}
		},

		{
			$sort: {
			soldCount: -1
			}
		}
	]);

    



	console.log("productSoldCounts == ",productSoldCounts)
	const totalProductsSold=productSoldCounts.reduce((acc,curr)=>acc+curr.soldCount,0)
	console.log("totalProuctsSold == ",totalProductsSold)


  return {report, totalOrdersCount, totalOfferDiscount, totalCouponDiscount, totalIncome, productSoldCounts, totalProductsSold};
}





const getSalesReport=async (req,res)=>{
    try {
        const {type, start, end} = req.query;

        const {
          report, 
          totalOrdersCount, 
          totalOfferDiscount, 
          totalCouponDiscount,
          totalIncome,
		  productSoldCounts,
		  totalProductsSold
        }=await getReportData(type,start,end)

        return res.json({
          report,
          totalOrdersCount,
          totalOfferDiscount,
          totalCouponDiscount,
          totalIncome,
		  productSoldCounts,
		  totalProductsSold
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
          totalIncome,
          productSoldCounts,
		  totalProductsSold
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
        .text("Total Sales (Rs)", 210, headerY)
        .text("Offer Discount (Rs)", 310, headerY)
        .text("Coupon Discount (Rs)", 410, headerY)
        .text("Avg Order Value (Rs)", 520, headerY, { align: "right" });

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
        doc.text(`Rs.${r.totalSales.toFixed(2)}`, 210, y);
        doc.text(`Rs.${r.totalOfferDiscount.toFixed(2)}`, 310, y);
        doc.text(`Rs.${r.totalCouponDiscount.toFixed(2)}`, 410, y);
        doc.text(`Rs.${r.avgOrderValue?.toFixed(2) || "-"}`, 520, y, { align: "right" });


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
        doc.text(`Total Offer Discount: Rs.${totalOfferDiscount.toFixed(2)}`, 40);
        doc.text(`Total Coupon Discount:  Rs.${totalCouponDiscount.toFixed(2)}`, 40);
        doc.text(`Total Income:          Rs.${totalIncome.toFixed(2)}`, 40);

        // ⭐ ADD TOTAL PRODUCTS SOLD HERE
        doc.text(`Total Products Sold: ${totalProductsSold}`, 40);



        // 🔥 ADD PRODUCT SOLD COUNTS HERE
        // ----------------------------------------------
        doc.moveDown(1.5);
        doc.fontSize(12).font("Helvetica-Bold");
        doc.text("Products Sold Count", 40);

        doc.moveDown(0.5);
        doc.fontSize(10).font("Helvetica");

        // If no products found
        if (!productSoldCounts.length) {
            doc.text("No products sold in this period.", 40);
        } else {
            productSoldCounts.forEach((p, index) => {
                doc.text(
                    // `${index + 1}. ${p.productName} — Sold: ${p.soldCount}`,
                    `${p.productName} (${p.brand}, ${p.category}) — Sold: ${p.soldCount}`,

                    40,
                    doc.y,
                    { width: 500 }
                );
                doc.moveDown(0.2);
            });
        }

        doc.moveDown(2);



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






const getSalesReportExcel = async (req, res) => {
    try {
        const { type, start, end } = req.query;

        const {
            report,
            totalOrdersCount,
            totalOfferDiscount,
            totalCouponDiscount,
            totalIncome,
            productSoldCounts,
            totalProductsSold
        } = await getReportData(type, start, end);

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("TeeSpace Sales Report");

        // ------------------------------------------
        // 🔹 MAIN REPORT TABLE
        // ------------------------------------------
        sheet.columns = [
            { header: "Period", key: "period", width: 25 },
            { header: "Total Orders", key: "totalOrders", width: 15 },
            { header: "Total Sales (Rs.)", key: "totalSales", width: 20 },
            { header: "Average Order Value (Rs.)", key: "avgOrderValue", width: 25 },
            { header: "Total Offer Discount (Rs.)", key: "totalOfferDiscount", width: 20 },
            { header: "Total Coupon Discount (Rs.)", key: "totalCouponDiscount", width: 20 },
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
                totalCouponDiscount: r.totalCouponDiscount,
            });
        });

        // ------------------------------------------
        // 🔹 SUMMARY SECTION
        // ------------------------------------------
        sheet.addRow([]); // empty row

        const summaryHeader = sheet.addRow(["Summary Totals"]);
        summaryHeader.font = { bold: true, size: 14 };
        summaryHeader.alignment = { horizontal: "left" };

        sheet.addRow(["Total Orders", totalOrdersCount]);
        sheet.addRow(["Total Offer Discount (Rs.)", totalOfferDiscount.toFixed(2)]);
        sheet.addRow(["Total Coupon Discount (Rs.)", totalCouponDiscount.toFixed(2)]);
        sheet.addRow(["Total Income (Rs.)", totalIncome.toFixed(2)]);
        
        // ⭐ ADD TOTAL PRODUCTS SOLD
        sheet.addRow(["Total Products Sold", totalProductsSold]);

        // ------------------------------------------
        // 🔹 PRODUCTS SOLD COUNT LIST
        // ------------------------------------------
        sheet.addRow([]); // empty row

        const productHeader = sheet.addRow(["Product Sold Counts"]);
        productHeader.font = { bold: true, size: 14 };

        // Define columns for product list
        sheet.addRow([]); // empty row

        sheet.addRow(["#", "Product Name", "Category", "Brand", "Sold Count"]);
        const headerRow = sheet.lastRow;
        headerRow.font = { bold: true };

        // Adjust widths
        sheet.getColumn(1).width = 5;
        sheet.getColumn(2).width = 35;
        sheet.getColumn(3).width = 20;
        sheet.getColumn(4).width = 20;
        sheet.getColumn(5).width = 15;

        productSoldCounts.forEach((p, index) => {
            sheet.addRow([
                index + 1,
                p.productName,
                p.category || "-",
                p.brand || "-",
                p.soldCount
            ]);
        });

        // ------------------------------------------
        // 🔹 SEND FILE
        // ------------------------------------------
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
        console.log("getSalesReportExcel() error===========>", error);
    }
};



module.exports={
    getSalesReportPage,
    getSalesReport,
    getSalesReportPDF,
    getSalesReportExcel
}






// const obj={
//     orderStatus:"Delivered",
//     orderItems:[
//         {
//             productId:"",
//             quantity:1,
//             totalAmout:100,
//             itemStatus:"Delivered",
//             refundStatus:"Refunded to your wallet"
//         },
//         {
//             productId:"",
//             quantity:2,
//             totalAmount:200,
//             itemStatus:"Cancelled",
//             refundStatus:"Refunded to your wallet"
//         },
//     ]
// }