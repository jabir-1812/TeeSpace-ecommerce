const Status=require('../../constants/statusCodes')
const Order=require('../../models/orderSchema')
const Product=require('../../models/productSchema')
const Category=require('../../models/categorySchema')
const Brand=require('../../models/brandSchema')
const DELIVERY_STATUS=require('../../constants/deliveryStatus.enum')





const loadDashboard = async (req, res) => {
  try {
    return res.render("./admin/dashboard/dashboard", {
                layout:"adminLayout",
                title: "Admin Dashboard",
                topProducts:[]
            });
  } catch (error) {
    console.log("loadDashboard() error=====",error)
    res.redirect("/admin/page-error");
  }
};












const getTopTenProducts=async(req,res)=>{
    try {
        const type = req.query.type || 'daily';
        const start = req.query.start || null;
        const end = req.query.end || null;

        const result=await getTopTenProductsData(type, start, end);
        return res.json(result)
    } catch (error) {
        console.error("getTopTenProducts() error======",error);
        res.status(Status.INTERNAL_ERROR).json({message:"something went wrong",error:error.message})
    }
}




const getTopTenCategories=async (req,res)=>{
    try {
        console.log("top cat working")
        const type = req.query.type || 'daily';
        const start = req.query.start || null;
        const end = req.query.end || null;
        console.log("startttttttttttt",type,start,end)
        const result=await getTopTenCatgoriesData(type, start, end);
        return res.json(result)
    } catch (error) {
        console.error("getTopTenCategories() error======",error);
        res.status(Status.INTERNAL_ERROR).json({message:"something went wrong",error:error.message})
    }
}






const getTopTenBrands=async (req,res)=>{
    try {
        console.log("top brand working")
        const type = req.query.type || 'daily';
        const start = req.query.start || null;
        const end = req.query.end || null;
        console.log("startttttttttttt",type,start,end)
        const result=await getTopTenBrandsData(type, start, end);
        return res.json(result)
    } catch (error) {
        console.error("getTopTenCategories() error======",error);
        res.status(Status.INTERNAL_ERROR).json({message:"something went wrong",error:error.message})
    }
}






// async function getTopTenProductsData(type) {
// }

// helper to build date range
function getDateRange(type) {
    const now = new Date();
    let start, end;


    switch (type) {
        case "daily":
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            end = new Date(start);
            end.setDate(end.getDate() + 1);
            // console.log("start&end",start, end)
            break;


        case "weekly":
            const day = now.getDay();
            start = new Date(now);
            start.setDate(now.getDate() - day);
            start.setHours(0,0,0,0);
            end = new Date(start);
            end.setDate(end.getDate() + 7);
            break;


        case "monthly":
            start = new Date(now.getFullYear(), now.getMonth(), 1);
            end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            break;


        case "yearly":
            start = new Date(now.getFullYear(), 0, 1);
            end = new Date(now.getFullYear() + 1, 0, 1);
            break;
    }


    return { start, end };
}

// Main function for best-selling products
async function getTopTenProductsData(type, customStart = null, customEnd = null) {
    let start, end;


    if (type === "custom" && customStart && customEnd) {
        start = new Date(customStart);
        end = new Date(customEnd);
        end.setDate(end.getDate() + 1);
    } else {
        ({ start, end } = getDateRange(type));
    }


    const data = await Order.aggregate([
        { $match: { orderStatus: "Delivered", deliveredOn: { $gte: start, $lt: end } } },
        { $unwind: "$orderItems" },
        { $match: { "orderItems.itemStatus": "Delivered", "orderItems.returnStatus": { $ne: "Refunded" } } },
        {
            $group: {
            _id: "$orderItems.productId",
            totalSold: { $sum: "$orderItems.quantity" }
            }
        },
        {
        $lookup: {
                from: "products",
                localField: "_id",
                foreignField: "_id",
                as: "product"
            }
        },
        { $unwind: "$product" },
        {
            $project: {
                _id: 1,
                totalSold: 1,
                productName: "$product.productName",
                productImage: "$product.productImage"
            }
        },
        { $sort: { totalSold: -1 } },
        { $limit: 10 }
    ]);


    // console.log("Daatatatttt",data)
    return data;
}







async function getTopTenCatgoriesData(type, customStart = null, customEnd = null) {
    let start, end;


    if (type === "custom" && customStart && customEnd) {
        start = new Date(customStart);
        end = new Date(customEnd);
        end.setDate(end.getDate() + 1);
    } else {
        ({ start, end } = getDateRange(type));
    }


    const data=await Order.aggregate([
            {$match:{orderStatus:"Delivered",deliveredOn:{$gte:start, $lt:end}}},
            { $unwind: "$orderItems" },
            { $match: { "orderItems.itemStatus": "Delivered", "orderItems.returnStatus": { $ne: "Refunded" } } },

            // Join product to get categoryId
            {
                $lookup: {
                from: "products",
                localField: "orderItems.productId",
                foreignField: "_id",
                as: "product"
                }
            },

            { $unwind: "$product" },

            // Group by categoryId
            {
                $group: {
                _id: "$product.category",
                totalSold: { $sum: "$orderItems.quantity" }
                }
            },

            // Sort by most sold
            { $sort: { totalSold: -1 } },

            // Limit to top 10
            { $limit: 10 },

            // Optional: join with categories to show names
            {
                $lookup: {
                from: "categories",
                localField: "_id",
                foreignField: "_id",
                as: "category"
                }
            },

            { $unwind: "$category" },

            // Final result format
            {
                $project: {
                _id: 0,
                categoryId: "$_id",
                categoryName: "$category.name",
                totalSold: 1
                }
            }
        ])



    console.log("Daatatatttt",data)
    return data;
}





async function getTopTenBrandsData(type, customStart = null, customEnd = null) {
    let start, end;


    if (type === "custom" && customStart && customEnd) {
        start = new Date(customStart);
        end = new Date(customEnd);
        end.setDate(end.getDate() + 1);
    } else {
        ({ start, end } = getDateRange(type));
    }


    const data=await Order.aggregate([
            {$match:{orderStatus:"Delivered",deliveredOn:{$gte:start, $lt:end}}},
            { $unwind: "$orderItems" },
            { $match: { "orderItems.itemStatus": "Delivered", "orderItems.returnStatus": { $ne: "Refunded" } } },

            // Join product to get categoryId
            {
                $lookup: {
                from: "products",
                localField: "orderItems.productId",
                foreignField: "_id",
                as: "product"
                }
            },

            { $unwind: "$product" },

            // Group by categoryId
            {
                $group: {
                _id: "$product.brand",
                totalSold: { $sum: "$orderItems.quantity" }
                }
            },

            // Sort by most sold
            { $sort: { totalSold: -1 } },

            // Limit to top 10
            { $limit: 10 },

            // Optional: join with categories to show names
            {
                $lookup: {
                from: "brands",
                localField: "_id",
                foreignField: "_id",
                as: "brand"
                }
            },

            { $unwind: "$brand" },

            // Final result format
            {
                $project: {
                _id: 0,
                brandId: "$_id",
                brandName: "$brand.brandName",
                totalSold: 1
                }
            }
        ])



    console.log("Daatatatttt",data)
    return data;
}










module.exports = {
    loadDashboard,
    getTopTenProducts,
    getTopTenCategories,
    getTopTenBrands
};




const order={
    orderStatus:"Delivered",
    DeliveredOn:'2025-11-15T11:20:25.032+00:00',
    orderItems:[
        {
            itemStatus:"Delivered",
            deliveredOn:"2025-11-15T11:20:25.032+00:00",
            productId:"ref id",
            quantity:10,
        }
    ]
}


