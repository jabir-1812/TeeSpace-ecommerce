const Status=require('../../constants/statusCodes')
const DELIVERY_STATUS=require('../../constants/deliveryStatus.enum')
const Order=require('../../models/orderSchema');
const User=require('../../models/userSchema');
const Wallet=require('../../models/walletSchema')
const Product=require('../../models/productSchema')
const {generateInvoiceNumber}=require('../../utils/invoice')



const listAllOrders=async (req,res)=>{
    try {
        let { page = 1, limit = 10, search = "", status = "", sort = "newest" } = req.query;
        page = parseInt(page);
        limit = parseInt(limit);

        const query = {};

        //  Search (orderId OR user name/email)
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

        //  Filter by status
        if (status) {
        query.orderStatus = status;
        }

        //  Sorting
        let sortOption = { createdAt: -1 }; // default newest
        if (sort === "oldest") sortOption = { createdAt: 1 };
        if (sort === "amountAsc") sortOption = { totalAmount: 1 };
        if (sort === "amountDesc") sortOption = { totalAmount: -1 };

        // Pagination
        const totalOrders = await Order.countDocuments(query);
        const orders = await Order.find(query)
        .populate("userId", "name email")
        .sort(sortOption)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

        res.render("admin/order/orders", {
        layout:"adminLayout",
        title: "All Orders",
        orders,
        currentPage: page,
        totalPages: Math.ceil(totalOrders / limit),
        search,
        status,
        sort
        });
    } catch (error) {
        console.log('listAllOrders()   error======>',error)
        res.redirect('page-error')
    }
}



const getOrderDetails=async (req,res)=>{
    try {
        const order = await Order.findById(req.params.orderId)
      .populate("userId", "name email phone")
      .lean();

    res.render("admin/order/order-details", {layout:"adminLayout", order, title: "Order Details" });
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
        const order = await Order.findOne({ orderId });
        if (!order) return res.status(Status.NOT_FOUND).json({ success: false, message: "Order not found" });

        // Find item inside order
        const item = order.orderItems.id(itemId);
        if (!item) return res.status(Status.NOT_FOUND).json({ success: false, message: "Item not found" });

        if(!Object.values(DELIVERY_STATUS).includes(status)){
            return res.status(Status.BAD_REQUEST).json({message:"Invalid delivery status"})
        }

        // Update status
        item.itemStatus = status;
        if(status===DELIVERY_STATUS.DELIVERED){
            item.deliveredOn=new Date();
        }

        // --- Update overall orderStatus based on items ---
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

        

        // --- 🔑 Invoice logic ---
        if (!order.invoice?.generated) {
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

    const updateFields = {
      "orderItems.$.returnStatus": action === "approve" ? "Approved" : "Rejected"
    };

    //  If rejected, also store rejection reason
    if (action === "reject") {
      updateFields["orderItems.$.rejectionReason"] = reason || "No reason provided";
    }

    const order = await Order.findOneAndUpdate(
      { orderId: orderId, "orderItems._id": itemId },
      { $set: updateFields },
      { new: true }
    );

    res.json({ success: true, status: action });
  } catch (err) {
    console.error("manageReturnRequest() error=====",err);
    res.status(500).json({ success: false, message: "Something went wrong" });
  }
};


// const updateReturnStatus=async(req,res)=>{
//   try {
//     const { orderId, itemId, status } = req.body;

//     const order = await Order.findOne({ orderId });
//     if (!order) return res.json({ success: false, message: "Order not found" });

//     const item = order.orderItems.id(itemId);
//     console.log("item=====>",item)
//     if (!item) return res.json({ success: false, message: "Item not found" });

//     if(item.refundStatus==="Refunded to your wallet"){
//         return res.json({success:false,message:"Already refunded"})
//     }

//     item.returnStatus = status;
//     item.refundStatus = "Refunded to your wallet";

//     if (status === "Refunded") {
//         await Product.findByIdAndUpdate(item.productId, {
//             $inc: { quantity: item.quantity }  // increase stock back
//         });
//         const refundAmount = item.finalPaidAmount || item.price;
//         // const offerDiscount=item.offerDiscount;
//         // const couponDiscount=item.couponDiscount;


//     //   if (order.paymentMethod === "Cash on Delivery" || order.paymentMethod==="TeeSpace Wallet") {
//     //     // ✅ COD → refund to wallet
//     //     let wallet = await Wallet.findOne({ userId: order.userId });
//     //     if (!wallet) {
//     //       wallet = new Wallet({ userId: order.userId, balance: 0, transactions: [] });
//     //     }

//     //     wallet.balance += refundAmount;
//     //     wallet.transactions.push({
//     //       amount: refundAmount,
//     //       type: "credit",
//     //       description: `Refund for ${item.productName} (Order ${order.orderId})`
//     //     });

//     //     await wallet.save();
//     //     item.refundStatus="Refunded";
//     //     item.refundedOn= new Date();
//     //   }else if (order.paymentMethod === "Online Payment" && paymentStatus==="Paid") {
//     //     // ✅ Online payment → just mark refunded (no wallet credit)
//     //     item.refundStatus = "Refunded";
//     //     item.refundedOn = new Date();
//     //   }
//         let wallet = await Wallet.findOne({ userId: order.userId });
//         if (!wallet) {
//             wallet = new Wallet({ userId: order.userId, balance: 0, transactions: [] });
//         }

//         wallet.balance += refundAmount;
//         wallet.transactions.push({
//             amount: refundAmount,
//             type: "credit",
//             description: `Refund for ${item.productName} (Order ${order.orderId})`
//         });

//         await wallet.save();
//         item.refundStatus="Refunded to your wallet";
//         item.refundedOn= new Date();

//         // order.totalMrp-=(refundAmount+offerDiscount+couponDiscount);
//         // order.totalPrice-=(refundAmount+offerDiscount);
//         // order.totalAmount-=refundAmount;
//         // order.totalOfferDiscount-=offerDiscount;
//         // order.totalCouponDiscount-=couponDiscount;
//     }

//     await order.save();
//     res.json({ success: true });

//   }catch (error) {
//     console.error("updateReturnStatus() error=====>",error);
//     res.json({ success: false, message: "Error updating return status" });
//   }
// }

const updateReturnStatus=async(req,res)=>{
  try {
    const { orderId, itemId, status } = req.body;

    const order = await Order.findOne({ orderId });
    if (!order) return res.json({ success: false, message: "Order not found" });

    const returningItem = order.orderItems.id(itemId);
    console.log("item=====>",returningItem)
    if (!returningItem) return res.json({ success: false, message: "Item not found" });

    if(returningItem.refundStatus==="Refunded to your wallet"){
        return res.json({success:false,message:"Already refunded"})
    }

    returningItem.returnStatus = status;

    if (status === "Refunded") {
        await Product.findByIdAndUpdate(returningItem.productId, {
            $inc: { quantity: returningItem.quantity }  // increase stock back
        });

        if(order.appliedCoupons.length>0){
            const currentOrderTotalPrice=order.orderItems
                .filter((item)=>{
                    return item.refundStatus !== "Refunded to your wallet" && item._id.toString() !== returningItem._id.toString()
                })
                .reduce((total, item)=>{
                    // return total+item.finalPaidAmount;
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

    await order.save();
    res.json({ success: true });

  }catch (error) {
    console.error("updateReturnStatus() error=====>",error);
    res.json({ success: false, message: "Error updating return status" });
  }
}


module.exports={
    listAllOrders,
    getOrderDetails,
    updateItemStatus,
    manageReturnRequest,
    updateReturnStatus
}
