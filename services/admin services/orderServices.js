import User from '../../models/userSchema.js';
import Order from '../../models/orderSchema.js';
import Product from '../../models/productSchema.js';
import Wallet from '../../models/walletSchema.js';
import DELIVERY_STATUS from '../../constants/deliveryStatus.enum.js';
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



async function findItemFromOrder(order, itemId) {
    return order.orderItems.id(itemId)
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





async function manageReturnRequest(action,reason,orderId, itemId) {
    const updateFields = {
        "orderItems.$.returnStatus": action === "approve" ? "Approved" : "Rejected"
    };

    //  If rejected, also store rejection reason
    if (action === "reject") {
        updateFields["orderItems.$.rejectionReason"] = reason || "No reason provided";
    }

    return  Order.findOneAndUpdate(
        { orderId: orderId, "orderItems._id": itemId },
        { $set: updateFields },
        { new: true }
    );
}





async function increaseStockBack(productId, quantity) {
    return Product.updateOne({_id:productId}, {$inc:{quantity:quantity}})
}





async function refund(order,returningItem) {
    console.log("returning item ==", returningItem)
    //recalculating the coupon discount
    //to check if the order meeting the coupon conditions or not.
    if(order.appliedCoupons.length>0){
        //currentOrderTotalPrice ==> orders that user still keeping.
        //it won't contains, already refunded
        const currentOrderTotalPrice=order.orderItems
            .filter((item)=>{
                return item.refundStatus !== "Refunded to your wallet" && item._id.toString() !== returningItem._id.toString()
            })
            .reduce((total, item)=>{
                return total+item.totalSalePrice;
            },0)

        console.log("currentOrderTotalPrice==========",currentOrderTotalPrice)

        const applicableCoupons=order.appliedCoupons.filter((appliedCoupon)=>{
            return appliedCoupon.minPurchase <= currentOrderTotalPrice
        })

        console.log("applicable coupon length========",applicableCoupons.length)

        if(applicableCoupons.length > 0){
            let finalTotalOfferDiscount=0;
            let finalTotalCouponDiscount=0;
            let finalTotalPrice=0;
            let finalTotalAmount=0;

            for(const item of order.orderItems){
                if(item._id.toString() === returningItem._id.toString() || item.refundStatus === "Refunded to your wallet"){
                    continue;
                }

                const itemTotalPrice=item.finalPaidAmount + item.finalCouponDiscount;
                let itemTotalCouponDiscount=0;

                console.log("item.finalPaidAmount====",item.finalPaidAmount)
                console.log("item.finalCouponDiscount===",item.finalCouponDiscount)
                console.log("itemTotalPrice====",itemTotalPrice)

                for(const coupon of applicableCoupons){
                    if(coupon.isCategoryBased){
                        //if the product is other category, skip this coupon application for that product
                        if(
                            !coupon.applicableCategories
                            .some((catId)=>{return catId.toString()=== item.categoryId.toString()})
                            ){
                                continue;
                        }

                        let discount=0;
                        if(coupon.discountType === "percentage"){
                            discount=(itemTotalPrice * coupon.discountValue)/100;
                        }

                        if(coupon.discountType === "fixed"){
                            discount=(itemTotalPrice / currentOrderTotalPrice)/coupon.discountValue;
                        }

                        //cap max discount
                        if(coupon.maxDiscountAmount && discount > coupon.maxDiscountAmount){
                            discount=coupon.maxDiscountAmount;
                        }

                        itemTotalCouponDiscount +=discount;

                    }

                    
                    if(!coupon.isCategoryBased){
                        let discount=0;

                        if(coupon.discountType === "percentage"){
                            discount=(itemTotalPrice * coupon.discountValue)/100;
                        }

                        if(coupon.discountType === "fixed"){
                            discount=(itemTotalPrice / currentOrderTotalPrice)/coupon.discountValue
                        }

                        //cap max discount
                        if(coupon.maxDiscountAmount && discount > coupon.maxDiscountAmount){
                            discount=coupon.maxDiscountAmount;
                        }

                        itemTotalCouponDiscount+=discount;
                    }
                }

                console.log("itemTotalCouponDiscount============",itemTotalCouponDiscount)

                //storing updated price & coupon discount of the item
                item.finalCouponDiscount=itemTotalCouponDiscount;
                item.finalPaidAmount = item.totalSalePrice - itemTotalCouponDiscount;

                finalTotalOfferDiscount +=item.offerDiscount;
                finalTotalPrice += item.totalSalePrice;
                finalTotalCouponDiscount +=itemTotalCouponDiscount;
                finalTotalAmount +=(item.totalSalePrice - itemTotalCouponDiscount)

            }

            console.log("final total coupon discount=====",finalTotalCouponDiscount)
            console.log(" final total offer discount========== ",finalTotalOfferDiscount)
            console.log(" final total price===",finalTotalPrice)
            console.log("final total amount====",finalTotalAmount)
            //storing updated price details of the entire order
            order.finalTotalOfferDiscount=finalTotalOfferDiscount
            order.finalTotalCouponDiscount = finalTotalCouponDiscount;
            order.finalTotalPrice=finalTotalPrice;
            order.finalTotalAmount=finalTotalAmount;
            await order.save();

            //after re-calculating the new coupon discount for existing items
            //calculating the new total price for the existing items.
            //now we need this amount, rest will be refunded
            const newOrderTotalPrice=currentOrderTotalPrice - finalTotalCouponDiscount;
            console.log("newORderTotalPrice===========",newOrderTotalPrice)

            //now, we need the amount for existing items, we keep it,
            //also, we decreasing the already refunded amount,
            //and refunding the rest
            const refundAmount=order.totalAmount-(newOrderTotalPrice + order.refundedAmount);
            console.log("order.refunded amount===",order.refundedAmount)
            console.log("refund amount====",refundAmount)

            let userWallet=await Wallet.findOne({userId:order.userId})
            if(!userWallet){
                userWallet = new Wallet({ userId: order.userId, balance: 0, transactions: [] });
            }

            userWallet.balance+=refundAmount;
            userWallet.transactions.push({
                amount:refundAmount,
                type:"credit",
                description:`Refund for ${returningItem.productName} (Order ${order.orderId})`
            })
            await userWallet.save();
            returningItem.refundStatus = "Refunded to your wallet";
            returningItem.refundedOn = new Date();

            //updating total refunded amount in DB
            order.refundedAmount += refundAmount;
            await order.save();
        }

        if(applicableCoupons.length === 0){
            //which means no product will have coupon discount
            //every product will be bought on saleprice
            const currentOrderTotalPrice = order.orderItems
                .filter((item)=>{
                    return item.refundStatus !== "Refunded to your wallet" && item._id.toString() !== returningItem._id.toString()
                }).reduce((total,item)=>{
                    return total + item.price + item.couponDiscount
                },0)

            //keeping current total, and refunding the rest
            const refundAmount=order.totalAmount - (currentOrderTotalPrice  + order.refundedAmount);

            let userWallet = await Wallet.findOne({userId:order.userId})
            if(!userWallet){
                userWallet = new Wallet({ userId: order.userId, balance: 0, transactions: [] });
            }

            userWallet.balance+=refundAmount;
            userWallet.transactions.push({
                amount:refundAmount,
                type:"credit",
                description:`Refund for ${returningItem.productName} (Order ${order.orderId})`
            })
            await userWallet.save();
            returningItem.refundStatus = "Refunded to your wallet";
            returningItem.refundedOn = new Date();

            order.refundedAmount += refundAmount

            //removing all coupon discount, because this order has no applicable coupon now.
            //not eligible for coupon
            for(const item of order.orderItems){
                item.finalPaidAmount=item.salePrice;
                item.finalCouponDiscount = 0;
            }

            const finalTotalPrice=order.orderItems
                    .filter((item)=>{
                        return item._id.toString() !== returningItem._id.toString() && item.refundStatus !== "Refunded to your wallet"
                    })
                    .reduce((totalPrice,item)=>{
                        return totalPrice + item.totalSalePrice
                    },0)

            order.finalTotalCouponDiscount=0;
            order.finalTotalPrice=finalTotalPrice;
            order.finalTotalAmount=finalTotalPrice;

            const finalTotalOfferDiscount=order.orderItems
                    .filter((item)=>{
                        return item.refundStatus !== "Refunded to your wallet" && item._id.toString() !== returningItem._id.toString()
                    })
                    .reduce((totalOfferDiscount,item)=>{
                        return totalOfferDiscount+item.offerDiscount
                    },0)

            order.finalTotalOfferDiscount=finalTotalOfferDiscount;
            await order.save();
        }
    }


    if(order.appliedCoupons.length === 0){
        //refund the paid amount
        let userWallet=await Wallet.findOne({userId:order.userId})
        if(!userWallet){
            userWallet = new Wallet({ userId: order.userId, balance: 0, transactions: [] });
        }

        userWallet.balance+=returningItem.price;
        userWallet.transactions.push({
            amount:returningItem.price,
            type:"credit",
            description:`Refund for ${returningItem.productName} (Order ${order.orderId})`
        })
        await userWallet.save();

        returningItem.refundStatus = "Refunded to your wallet";
        returningItem.refundedOn = new Date();

        order.refundedAmount+=returningItem.price;

        const finalTotalPrice=order.orderItems
            .filter((item)=>{
                return item._id.toString() !== returningItem._id.toString() && item.refundStatus !== "Refunded to your wallet"
            })
            .reduce((totalPrice,item)=>{
                return totalPrice + item.totalSalePrice
            },0)

        order.finalTotalPrice=finalTotalPrice;
        order.finalTotalAmount=finalTotalPrice;//because couponDiscount is = 0 to decrease from the sale price. means sale price is the total amount

        const finalTotalOfferDiscount=order.orderItems
            .filter((item)=>{
                return item.refundStatus !== "Refunded to your wallet" && item._id.toString() !== returningItem._id.toString()
            })
            .reduce((totalOfferDiscount,item)=>{
                return totalOfferDiscount+item.offerDiscount
            },0)

        order.finalTotalOfferDiscount=finalTotalOfferDiscount;
        //finalTotalCouponDiscount is already zero, because user had no applied coupon when placing order.
        await order.save();
    }

}




export default {
    listAllOrders,
    getOrderDetails,
    findOrder,
    findItemFromOrder,
    updateItemStatus,
    updateOrderLevelStatus,
    markDeliveredDate,
    generateInvoice, 
    manageReturnRequest,
    increaseStockBack,
    refund
}