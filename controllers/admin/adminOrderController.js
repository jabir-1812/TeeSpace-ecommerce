import Status from '../../constants/statusCodes.js'
import DELIVERY_STATUS from '../../constants/deliveryStatus.enum.js';
import Order from '../../models/orderSchema.js';
import User from '../../models/userSchema.js';
import Wallet from '../../models/walletSchema.js';
import Product from '../../models/productSchema.js';
import generateInvoiceNumber from '../../utils/invoice.js';
import orderServices from '../../services/admin services/orderServices.js';
import productServices from '../../services/admin services/productServices.js';



const listAllOrders = async (req, res) => {
    try {
        const { page, limit, search, status, sort } = req.query;

        const result = await orderServices.listAllOrders({
            page,
            limit,
            search,
            status,
            sort
        });

        res.render("admin/order/orders", {
            layout: "adminLayout",
            title: "All Orders",
            orders: result.orders,
            currentPage: result.currentPage,
            totalPages: result.totalPages,
            search,
            status,
            sort
        });

    } catch (error) {
        console.log("listAllOrders() error ====>", error);
        res.redirect("page-error");
    }
};



const getOrderDetails=async (req,res)=>{
    try {
        const order = await orderServices.getOrderDetails(req.params.orderId)

        res.render("admin/order/order-details", {
            layout:"adminLayout", 
            order, 
            title: "Order Details" 
        });
    } catch (error) {
        console.log("getOrderDetails() error=====>",error);
        res.redirect('/page-error')
    }
}

// Update item status in an order
const updateItemStatus = async (req, res) => {
    try {
        const { orderId, itemId, status } = req.body;

        // Find the order
        const order =await orderServices.findOrder(orderId)
        if (!order) return res.status(Status.NOT_FOUND).json({ success: false, message: "Order not found" });

        // Find item inside order
        const item = order.orderItems.id(itemId);
        if (!item) return res.status(Status.NOT_FOUND).json({ success: false, message: "Item not found" });

        if(!Object.values(DELIVERY_STATUS).includes(status)){
            return res.status(Status.BAD_REQUEST).json({message:"Invalid delivery status"})
        }

        // Update status
        await orderServices.updateItemStatus(item, status)
        if(status===DELIVERY_STATUS.DELIVERED){
            await orderServices.markDeliveredDate(item)
        }


        // --- Update overall orderStatus based on items ---
        await orderServices.updateOrderLevelStatus(order)
        

        // --- 🔑 Invoice logic ---
        if (!order.invoice?.generated) {
            await orderServices.generateInvoice(order)
        }

        await order.save();

        res.json({ 
            success: true, 
            message: "Status updated", 
            orderStatus: order.orderStatus,
            invoiceGenerated: order.invoice?.generated || false 
        });
    } catch (error) {
        console.log("updateItemStatus error:", error);
        res.status(Status.INTERNAL_ERROR).json({ success: false, message: "Internal server error" });
    }
};




const manageReturnRequest = async (req, res) => {
  try {
    const { orderId, itemId, action } = req.params;
    const { reason=null } = req.body;

    await orderServices.manageReturnRequest(action, reason, orderId, itemId)

    res.json({ success: true, status: action });
  } catch (err) {
    console.error("manageReturnRequest() error=====",err);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
};





const updateReturnStatus=async(req,res)=>{
  try {
    const { orderId, itemId, status } = req.body;

    const order = await orderServices.findOrder(orderId)

    if (!order) return res.json({ success: false, message: "Order not found" });

    const returningItem =await orderServices.findItemFromOrder(order, itemId)

    if (!returningItem) return res.json({ success: false, message: "Item not found" });

    if(returningItem.refundStatus==="Refunded to your wallet"){
        return res.json({success:false,message:"Already refunded"})
    }

    returningItem.returnStatus = status;

    if (status === "Refunded") {
        await orderServices.refund(order, returningItem)   
    }

    await order.save();
    res.json({ success: true });

  }catch (error) {
    console.error("updateReturnStatus() error=====>",error);
    res.json({ success: false, message: "Error updating return status" });
  }
}


export default {
    listAllOrders,
    getOrderDetails,
    updateItemStatus,
    manageReturnRequest,
    updateReturnStatus
}
