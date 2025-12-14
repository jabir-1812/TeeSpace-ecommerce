import User from '../../models/userSchema.js';
import Order from '../../models/orderSchema.js';





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






async function getOrderDetails(orderId) {
    return Order.findById(orderId)
      .populate("userId", "name email phone")
      .lean();
}






export default {
    listAllOrders,
    getOrderDetails
}