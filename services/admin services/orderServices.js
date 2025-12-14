import User from '../../models/userSchema.js';
import Order from '../../models/orderSchema.js';
import DELIVERY_STATUS from '../../constants/deliveryStatus.enum.js'
import generateInvoiceNumber from '../../utils/invoice.js';





async function listAllOrders({ page, limit, search, status, sort }) {
    page = parseInt(page) || 1;
    limit = parseInt(limit) || 10;

    const query = {};

    // Search (orderId OR user name/email)
    if (search) {
        const users = await User.find({
            $or: [
                { name: { $regex: search, $options: "i" } },
                { email: { $regex: search, $options: "i" } }
            ]
        }).select("_id");

        const userIds = users.map(u => u._id);

        query.$or = [
            { orderId: { $regex: search, $options: "i" } },
            { userId: { $in: userIds } }
        ];
    }

    // Filter by status
    if (status) {
        query.orderStatus = status;
    }

    // Sort options
    let sortOption = { createdAt: -1 }; // newest
    if (sort === "oldest") sortOption = { createdAt: 1 };
    if (sort === "amountAsc") sortOption = { totalAmount: 1 };
    if (sort === "amountDesc") sortOption = { totalAmount: -1 };

    // Fetch data
    const totalOrders = await Order.countDocuments(query);
    const orders = await Order.find(query)
        .populate("userId", "name email")
        .sort(sortOption)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

    return {
        orders,
        totalOrders,
        currentPage: page,
        totalPages: Math.ceil(totalOrders / limit)
    };
}





async function findOrder(orderId) {
    return Order.findOne({orderId:orderId})
}





async function getOrderDetails(orderId) {
    return Order.findById(orderId)
      .populate("userId", "name email phone")
      .lean();
}





async function updateItemStatus(item, status) {
    item.itemStatus = status
}





async function markDeliveredDate(item) {
    item.deliveredOn = new Date();
}




async function updateOrderLevelStatus(order) {
    const allStatuses = order.orderItems.map(i => i.itemStatus);
    const allStatusSet=new Set(allStatuses)

    if(allStatusSet.size===1 && allStatusSet.has(DELIVERY_STATUS.CANCELLED)){
        order.orderStatus = DELIVERY_STATUS.CANCELLED
    }
    if(allStatusSet.size===1 && allStatusSet.has(DELIVERY_STATUS.DELIVERED)){
        order.orderStatus = DELIVERY_STATUS.DELIVERED
        order.deliveredOn = new Date();
    }
    if(allStatusSet.size===2 && allStatusSet.has(DELIVERY_STATUS.DELIVERED) && allStatusSet.has(DELIVERY_STATUS.CANCELLED)){
        order.orderStatus=DELIVERY_STATUS.DELIVERED;
    
        const deliveredDates=order.orderItems
            .map((item)=>item.deliveredOn)
            .filter((date)=>date)
        deliveredDates.sort((a,b)=>a-b);
        const latestDeliveredDate=deliveredDates[deliveredDates.length-1];
        order.deliveredOn=latestDeliveredDate;
    }
}





async function generateInvoice(order) {
    const hasShippedOrDelivered = order.orderItems.some(
        (i) => i.itemStatus === DELIVERY_STATUS.SHIPPED || i.itemStatus === DELIVERY_STATUS.DELIVERED
    );

    if (hasShippedOrDelivered) {
        order.invoice = {
            number: await generateInvoiceNumber(), // custom function
            date: new Date(),
            generated: true,
        };
    }
}




export default {
    listAllOrders,
    getOrderDetails,
    findOrder,
    updateItemStatus,
    updateOrderLevelStatus,
    markDeliveredDate,
    generateInvoice
}