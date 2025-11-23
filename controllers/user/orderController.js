const Status=require('../../constants/statusCodes')
const DELIVERY_STATUS=require('../../constants/deliveryStatus.enum')
const Cart=require('../../models/cartSchema')
const Address=require('../../models/addressSchema')
const Product=require('../../models/productSchema')
const Order=require('../../models/orderSchema')
const getNextOrderId=require('../../utils/orderIdGenerator')
const User = require('../../models/userSchema')
const PDFDocument = require("pdfkit");
const Razorpay=require('razorpay')
const crypto = require('crypto')
const Wallet = require('../../models/walletSchema')
require('dotenv').config();
const Coupon=require('../../models/couponSchema')
// const { STATUS_CODES } = require('http')
// const { default: products } = require('razorpay/dist/types/products')

class AppError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true; // means: we expect this type of error
  }
}





const razorpay=new Razorpay({
  key_id:process.env.RAZORPAY_KEY_ID,
  key_secret:process.env.RAZORPAY_KEY_SECRET
})







const createRazorPayOrder = async(req,res)=>{
	try {
		const userId=req.session.user || req.session.passport?.user;
    if(!userId)return res.status(Status.BAD_REQUEST).json({message:"session expired"})

		const {addressId,appliedCoupons=[]}=req.body;

  //  Fetch address and copy it
      const userAddressDoc = await Address.findOne(
          { userId, "address._id": addressId },
          { "address.$": 1 }
      );
      if (!userAddressDoc || userAddressDoc.address.length === 0) {
          return res.status(404).json({ success: false, message: "Address not found, Add a new address" });
      }
      const selectedAddress = userAddressDoc.address[0];

    let userCart = await Cart.findOne({ userId })
          .populate({
            path: "items.productId",
            select: "productName productImage salePrice regularPrice brand quantity isBlocked category", // only the fields you need
            populate:[ 
            {
              path: "brand",
              select: "brandName",
            },
            {
              path:"category",
              select:"name"
            }
          ]
          })
    
      if(!userCart || userCart.items.length===0) return res.status(Status.BAD_REQUEST).json({status:false,message:"Cart is empty",reload:true})

      //validating all items in the cart
      const cartProductIds=userCart.items.map((item)=>{
          return item.productId._id
      })
      const validCartProducts=await Product.find({_id:{$in:cartProductIds}})
      const validCartProductsIds=validCartProducts.map((p)=>{return p._id.toString()})

      //returning only valid products to the user's cart,
      //removing the invalid products from user's cart
      userCart.items=userCart.items.filter((item)=>{
          return validCartProductsIds.includes(item.productId._id.toString())
      })

      //updating if any invalid products removed from user's cart
      if(userCart.items.length !== cartProductIds.length){
          return res.status(Status.BAD_REQUEST).json({message:"some products are invalid,please try again",reload:true})
      }

      let totalPrice=0;
      let totalAmount = 0;
      let isCartUpdated = false;//initially set as false.
      let anyOutOfStockProduct=false;


      // Check each item quantity vs stock
      for (const item of userCart.items) {
         //checking if any product is out of stock
          if(item.productId.quantity===0){
            anyOutOfStockProduct=true;
          }
        if (item.productId && item.quantity > item.productId.quantity) {
          item.quantity = item.productId.quantity; // reduce to available stock
          isCartUpdated = true;
        }
        totalPrice += (item.productId ? item.productId.salePrice : 0) * item.quantity;
        totalAmount += (item.productId ? item.productId.salePrice : 0) * item.quantity;
      }


      // If any change happened, save updated cart
      if (isCartUpdated) {
        await userCart.save();
        return res.status(Status.BAD_REQUEST).json({message:"Some products are few left or out of stock, Please re-check your cart",reload:true})
      }

      if(totalPrice===0){
        return res.status(Status.BAD_REQUEST).json({message:"Your cart is empty,re-check your cart and please try again",reload:true})
      }

      if(anyOutOfStockProduct){
        return res.status(Status.BAD_REQUEST).json({message:"There is 'out of stock' products, Please remove 'out of stock' product(s)",reload:true})
      }

      //if any coupon applied, calculate discount and reduce it from total price
      if(userCart.appliedCoupons.length > 0){
        if(appliedCoupons.length === userCart.appliedCoupons.length){
          //we have
          //appliedCoupon=[{},{}] from req.body
          //userCart.appliedCoupon=[{},{}]
          //checking both are matching and same
            const areCouponsMatch=userCart.appliedCoupons.every((userCartCoupon)=>{
              return appliedCoupons.some((formDataCoupon)=>{
                return (userCartCoupon.couponId.toString()===formDataCoupon.couponId &&
                userCartCoupon.code===formDataCoupon.couponCode)
              })
            })
            if(!areCouponsMatch){
              userCart.appliedCoupons=[];
              await userCart.save()
              return res.status(Status.INTERNAL_ERROR).json({message:"Coupon mismatch, please try again",reload:true})
            }
        }else{
          userCart.appliedCoupons=[];
          await userCart.save()
          return res.status(Status.INTERNAL_ERROR).json({message:"Coupon mismatch, please try again",reload:true})
        }
        
        //checking coupons are valid, and available
        const appliedCouponIds=userCart.appliedCoupons.map((appliedCoupon)=>{
            return appliedCoupon.couponId;
        })

        //fetching all applied coupon's original doc with the coupon ids
        const now = new Date();
        const coupons = await Coupon.find({
            _id: { $in: appliedCouponIds },
            isActive: true,
            expiryDate: { $gt: now },
            startDate: { $lt: now }
        });
        if(appliedCouponIds.length !== coupons.length){
          return res.status(Status.BAD_REQUEST).json({message:"Some coupons are expired or unavailable, Please try again",reload:true})
        }

        //re-checking if cart total meeting minPurchase for coupon discount.every coupon has atleast 0 minPurchase
        const areCouponsMeetMinPurchase=coupons.every((coupon)=>{
          return coupon.minPurchase <= totalPrice
        })
        if(!areCouponsMeetMinPurchase){
          userCart.appliedCoupons=[];
          userCart.save()
          return res.status(Status.BAD_REQUEST).json({message:"Minimum Purchase required for the coupon, Please try again",reload:true})
        }

        //check if the product is valid category
        for(const coupon of coupons){
          if(coupon.isCategoryBased){
            const applicableCategoryIds = coupon.applicableCategories.map(applicableCatId => applicableCatId.toString());
            const hasApplicableProduct=userCart.items.some((item)=>{
              return (item.productId?.category && applicableCategoryIds.includes(item.productId.category._id.toString()))
            })
            //if there is no applicable products, remove the coupon from user's cart
              if(!hasApplicableProduct){
                userCart.appliedCoupons=[]
                await userCart.save();
                return res.status(Status.BAD_REQUEST).json({message:"These product categories don't have this coupon discount, Please try again",reload:true})
              }
          }
        }

        //all set
        //calculate coupon discount
        const itemPriceDetails=[] //to store every product's total amount and total discount
        for(const item of userCart.items){
          const itemTotalMrp=item.productId.regularPrice * item.quantity;
          const itemTotalPrice=item.productId.salePrice * item.quantity;
          let itemTotalCouponDiscount=0;
          for(const coupon of coupons){
            if(coupon.isCategoryBased){
              //if the product is other category, skip this coupon application for that product
              if(
                !coupon.applicableCategories
                  .some((catId)=>{return catId.toString()=== item.productId.category._id.toString()})
                ){
                  continue;
                }

                let discount=0;
                if(coupon.discountType==="percentage"){
                  discount=(itemTotalPrice*coupon.discountValue)/100
                }else{
                  //if fixed discount
                  discount=(itemTotalPrice/totalPrice)*coupon.discountValue
                }

                //cap max discount
                if(coupon.maxDiscountAmount && discount> coupon.maxDiscountAmount){
                  discount=coupon.maxDiscountAmount;
                }

                itemTotalCouponDiscount+=discount;
            }else{//if coupon is not category based
                let discount=0;
              
                if(coupon.discountType==="percentage"){
                  discount=(itemTotalPrice*coupon.discountValue)/100
                }else{
                  //if fixed discount
                  discount=(itemTotalPrice/totalPrice)*coupon.discountValue
                }

                //cap max discount
                if(coupon.maxDiscountAmount && discount> coupon.maxDiscountAmount){
                  discount=coupon.maxDiscountAmount;
                }
                itemTotalCouponDiscount+=discount;
            }
          }
          itemPriceDetails.push({
            productId:item.productId._id.toString(),
            itemTotalMrp:itemTotalMrp,
            itemTotalPrice:itemTotalPrice,
            itemTotalCouponDiscount:itemTotalCouponDiscount,
            itemTotalAmount:itemTotalPrice-itemTotalCouponDiscount
          })
        }

        //prepare order items obj with coupon discount
        const orderItems=userCart.items.map((item)=>{
          return {
            productId:item.productId._id.toString(),
            productName:item.productId.productName,
            productImage:item.productId.productImage[0].url,
            quantity:item.quantity,
            itemStatus:DELIVERY_STATUS.PENDING
          }
        })

        // // console.log("orderItems BEFORE===========>",orderItems)

        orderItems.forEach((o)=>{
          const itemPrices=itemPriceDetails.find((i)=>{ return i.productId === o.productId})
          o.mrp=itemPrices.itemTotalMrp;
          o.couponDiscount=itemPrices.itemTotalCouponDiscount;
          o.offerDiscount=itemPrices.itemTotalMrp-itemPrices.itemTotalPrice;
          o.price=itemPrices.itemTotalAmount;

        })


        const totalMrp=itemPriceDetails.reduce((sum,curr)=>{
          return sum+curr.itemTotalMrp
        },0)

        const totalCouponDiscount=itemPriceDetails.reduce((sum,curr)=>{
          return sum+curr.itemTotalCouponDiscount
        },0)

        // const totalPrice=itemPriceDetails.reduce((sum,curr)=>{
        //   return sum+curr.itemTotalPrice
        // },0)

        const totalAmount=itemPriceDetails.reduce((sum,curr)=>{
          return sum+curr.itemTotalAmount
        },0)

        const totalOfferDiscount=totalMrp-totalPrice;

        //generate custom order ID
        const customOrderId = await getNextOrderId();

        // 5. Create order
        const newOrder = new Order({
            orderId: customOrderId,
            userId,
            shippingAddress: selectedAddress.toObject(),
            paymentMethod:"Online Payment",
            paymentStatus: "Pending", // update after payment success
            orderStatus: DELIVERY_STATUS.PENDING,
            orderItems,
            totalMrp,
            totalOfferDiscount,
            totalCouponDiscount,
            totalPrice,
            totalAmount
        });

        await newOrder.save();

        // Reduce stock
        for (let item of userCart.items) {
            await Product.findByIdAndUpdate(item.productId._id, {
                $inc: { quantity: -item.quantity }
            });
        }

        //  Clear cart
        // const result = await Cart.updateOne({userId}, { $set: { items: [],appliedCoupons:[] } });

        const options={
          amount:totalAmount*100,
          currency:"INR",
          receipt:customOrderId
        }

        const order =await razorpay.orders.create(options);
		    return res.json({order,teeSpaceOrderId:customOrderId});
      }

      // Prepare order items with itemStatus
      const orderItems = userCart.items.map(item => ({
        productId: item.productId._id,
        productName: item.productId.productName,
        productImage: item.productId.productImage[0].url,
        quantity: item.quantity,
        mrp:item.productId.regularPrice * item.quantity,
        price: item.productId.salePrice*item.quantity,
        offerDiscount:(item.productId.regularPrice * item.quantity)-(item.productId.salePrice * item.quantity),
        itemStatus: DELIVERY_STATUS.PENDING // 👈 every product starts as "Pending"
      }));


      const totalMrp=userCart.items.reduce((sum,item)=>{
        return sum+item.productId.regularPrice*item.quantity
      },0)

      const totalOfferDiscount=totalMrp-totalPrice;




		
      // 🔑 Generate custom order ID
      const customOrderId = await getNextOrderId();

      // 5. Create order
      const newOrder = new Order({
          orderId: customOrderId,
          userId,
          shippingAddress: selectedAddress.toObject(),
          paymentMethod:"Online Payment",
          paymentStatus: "Pending", // update after payment success
          orderStatus: DELIVERY_STATUS.PENDING,
          orderItems,
          totalMrp,
          totalPrice,
          totalOfferDiscount,
          totalAmount,
      });

      await newOrder.save();

      // 6. Reduce stock
      for (let item of userCart.items) {
          await Product.findByIdAndUpdate(item.productId._id, {
              $inc: { quantity: -item.quantity }
          });
      }

      // 7. Clear cart
      // await Cart.updateOne({userId}, { $set: { items: [] ,appliedCoupons:[]} });
      // console.log("newOrder===>orderId====>",newOrder);

      const options={
        amount:totalAmount*100,
        currency:"INR",
        receipt:customOrderId
      }
      console.log("option.amount=====>",options.amount)
      const order =await razorpay.orders.create(options);
      res.json({order,teeSpaceOrderId:customOrderId});
	} catch (error) {
		console.log("createRazorPayOrder() error=====>",error);

		// ❌ Unknown/internal error
		return res.status(Status.INTERNAL_ERROR).json({
		success: false,
		message: "Something went wrong. Please try again later."
		});
	}
}









const razorpayPaymentFailure=async (req,res)=>{
  try {
    const {razorpay_order_id, razorpay_payment_id, error_reason, appOrderId} = req.body;
    await Order.updateOne(
      {orderId:appOrderId},
      {
        paymentStatus:"Failed",
        razorPayOrderId:razorpay_order_id,
        razorPayPaymentId:razorpay_payment_id,
        razorPayFailureReason:error_reason
      }
    )
    res.json({success:true})
  } catch (error) {
    console.error("razorpayPaymentFailure() error========",error);
    return res.status(Status.INTERNAL_ERROR).json({message:"Something went wrong"})
  }
}








const showOrderFailurePage=async(req,res)=>{
  try {
    const userId=req.session.user || req.session.passport?.user;
    const userData=await User.findById(userId)
    const order=await Order.findOne({orderId:req.params.orderId})

    res.render('user/order-failure',{
      title:"Order Failed",
      order,
      razorPayKeyId:process.env.RAZORPAY_KEY_ID,
      user:userData,
      cartLength:null
    })
    
  } catch (error) {
    console.error("showOrderFailurePage() error==========",error);
    res.redirect('/page-not-found')
  }
}









const cancelFailedOrder=async(req,res)=>{
  try {
    const {orderId} = req.body;
    // await Order.updateOne(
    //   {orderId},
    //   {
    //     paymentStatus:"Failed",
    //     orderStatus:DELIVERY_STATUS.CANCELLED
    //   }
    // )
    await Order.updateOne(
      { orderId },
      {
        $set: {
          paymentStatus: "Failed",
          orderStatus: DELIVERY_STATUS.CANCELLED,
          "orderItems.$[elem].itemStatus": DELIVERY_STATUS.CANCELLED
        }
      },
      {
        arrayFilters: [{ "elem": { $exists: true } }]
      }
    );
    // Reverse stock
    const userId=req.session.user || req.session.passport?.user;
    const userCart=await Cart.findOne({userId})
      for (let item of userCart.items) {
          await Product.findByIdAndUpdate(item.productId._id, {
              $inc: { quantity: item.quantity }
          });
      }

    return res.json({success:true})
  } catch (error) {
    console.error("cancelFailedOrder() error=========",error)
    return res.status(Status.INTERNAL_ERROR).json({message:"Something went wrong"})
  }
}










//in this function, we are recreating the razorpay order
const retryPayment=async (req,res)=>{
  try {
    const {orderId}=req.body;
    if(!orderId){
      return res.status(Status.BAD_REQUEST).json({message:"Order not found",redirectToCheckoutPage:true})
    }

		const userId=req.session.user || req.session.passport?.user;
    const order=await Order.findOne({orderId})
    if(!order){
      return res.status(Status.BAD_REQUEST).json({message:"Order not found",redirectToCheckoutPage:true})
    }


    let userCart = await Cart.findOne({ userId })
          .populate({
            path: "items.productId",
            select: "productName productImage salePrice regularPrice brand quantity isBlocked category", // only the fields you need
            populate:[ 
            {
              path: "brand",
              select: "brandName",
            },
            {
              path:"category",
              select:"name"
            }
          ]
          })
    
      if(!userCart || userCart.items.length===0) return res.status(Status.BAD_REQUEST).json({status:false,message:"Cart is empty",redirectToCheckoutPage:true})

       //validating all items in the cart
        const cartProductIds=userCart.items.map((item)=>{
            return item.productId._id
        })
        const validCartProducts=await Product.find({_id:{$in:cartProductIds}})
        const validCartProductsIds=validCartProducts.map((p)=>{return p._id.toString()})

        //returning only valid products to the user's cart,
        //removing the invalid products from user's cart
        userCart.items=userCart.items.filter((item)=>{
            return validCartProductsIds.includes(item.productId._id.toString())
        })

        //updating if any invalid products removed from user's cart
        if(userCart.items.length !== cartProductIds.length){
            return res.status(Status.BAD_REQUEST).json({message:"some products are invalid,please try again",redirectToCheckoutPage:true})
        }

        let totalPrice=0;
        let totalAmount = 0;
        let isCartUpdated = false;//initially set as false.
        let anyOutOfStockProduct=false;



      // Check each item quantity vs stock
      for (const item of userCart.items) {
        //checking if any product is out of stock
          if(item.productId.quantity===0){
            anyOutOfStockProduct=true;
          }
        if (item.productId && item.quantity > item.productId.quantity) {
          item.quantity = item.productId.quantity; // reduce to available stock
          
          isCartUpdated = true;
        }
        totalPrice += (item.productId ? item.productId.salePrice : 0) * item.quantity;
        totalAmount += (item.productId ? item.productId.salePrice : 0) * item.quantity;
      }


      // If any change happened, save updated cart
      if (isCartUpdated) {
        await userCart.save();
        return res.status(Status.BAD_REQUEST).json({message:"Some products are few left or out of stock, Please re-check your cart",redirectToCheckoutPage:true})
      }

      if(totalPrice===0){
        return res.status(Status.BAD_REQUEST).json({message:"Your cart is empty,re-check your cart and please try again",redirectToCheckoutPage:true})
      }

      if(anyOutOfStockProduct){
        return res.status(Status.BAD_REQUEST).json({message:"There is 'out of stock' products, Please remove 'out of stock' product(s)",reload:true})
      }

      //if any coupon applied, calculate discount and reduce it from total price
      if(userCart.appliedCoupons.length > 0){
        //checking coupons are valid, and available
        const appliedCouponIds=userCart.appliedCoupons.map((appliedCoupon)=>{
            return appliedCoupon.couponId;
        })

        //fetching all applied coupon's original doc with the coupon ids
        const now = new Date();
        const coupons = await Coupon.find({
            _id: { $in: appliedCouponIds },
            isActive: true,
            expiryDate: { $gt: now },
            startDate: { $lt: now }
        });
        if(appliedCouponIds.length !== coupons.length){
          return res.status(Status.BAD_REQUEST).json({message:"Some coupons are expired or unavailable, Please try again",redirectToCheckoutPage:true})
        }

        //re-checking if cart total meeting minPurchase for coupon discount.every coupon has atleast 0 minPurchase
        const areCouponsMeetMinPurchase=coupons.every((coupon)=>{
          return coupon.minPurchase <= totalPrice
        })
        if(!areCouponsMeetMinPurchase){
          userCart.appliedCoupons=[];
          userCart.save()
          return res.status(Status.BAD_REQUEST).json({message:"Minimum Purchase required for the coupon, Please try again",redirectToCheckoutPage:true})
        }

        //check if the product is valid category
        for(const coupon of coupons){
          if(coupon.isCategoryBased){
            const applicableCategoryIds = coupon.applicableCategories.map(applicableCatId => applicableCatId.toString());
            const hasApplicableProduct=userCart.items.some((item)=>{
              return (item.productId?.category && applicableCategoryIds.includes(item.productId.category._id.toString()))
            })
            //if there is no applicable products, remove the coupon from user's cart
              if(!hasApplicableProduct){
                userCart.appliedCoupons=[]
                await userCart.save();
                return res.status(Status.BAD_REQUEST).json({message:"These product categories don't have this coupon discount, Please try again",redirectToCheckoutPage:true})
              }
          }
        }


        //all set
        //calculate coupon discount
        const itemPriceDetails=[] //to store every product's total amount and total discount
        for(const item of userCart.items){
          const itemTotalMrp=item.productId.regularPrice * item.quantity;
          const itemTotalPrice=item.productId.salePrice * item.quantity;
          let itemTotalCouponDiscount=0;
          for(const coupon of coupons){
            if(coupon.isCategoryBased){
              //if the product is other category, skip this coupon application for that product
              if(
                !coupon.applicableCategories
                  .some((catId)=>{return catId.toString()=== item.productId.category._id.toString()})
                ){
                  continue;
                }

                let discount=0;
                if(coupon.discountType==="percentage"){
                  discount=(itemTotalPrice*coupon.discountValue)/100
                }else{
                  //if fixed discount
                  discount=(itemTotalPrice/totalPrice)*coupon.discountValue
                }

                //cap max discount
                if(coupon.maxDiscountAmount && discount> coupon.maxDiscountAmount){
                  discount=coupon.maxDiscountAmount;
                }

                itemTotalCouponDiscount+=discount;
            }else{//if coupon is not category based
                let discount=0;
              
                if(coupon.discountType==="percentage"){
                  discount=(itemTotalPrice*coupon.discountValue)/100
                }else{
                  //if fixed discount
                  discount=(itemTotalPrice/totalPrice)*coupon.discountValue
                }

                //cap max discount
                if(coupon.maxDiscountAmount && discount> coupon.maxDiscountAmount){
                  discount=coupon.maxDiscountAmount;
                }
                itemTotalCouponDiscount+=discount;
            }
          }
          itemPriceDetails.push({
            productId:item.productId._id.toString(),
            itemTotalMrp:itemTotalMrp,
            itemTotalPrice:itemTotalPrice,
            itemTotalCouponDiscount:itemTotalCouponDiscount,
            itemTotalAmount:itemTotalPrice-itemTotalCouponDiscount
          })
        }

        //prepare order items obj with coupon discount
        const orderItems=userCart.items.map((item)=>{
          return {
            productId:item.productId._id.toString(),
            productName:item.productId.productName,
            productImage:item.productId.productImage[0].url,
            quantity:item.quantity,
            itemStatus:DELIVERY_STATUS.PENDING
          }
        })

         orderItems.forEach((o)=>{
          const itemPrices=itemPriceDetails.find((i)=>{ return i.productId === o.productId})
          o.mrp=itemPrices.itemTotalMrp;
          o.couponDiscount=itemPrices.itemTotalCouponDiscount;
          o.offerDiscount=itemPrices.itemTotalMrp-itemPrices.itemTotalPrice;
          o.price=itemPrices.itemTotalAmount;

        })


        const totalMrp=itemPriceDetails.reduce((sum,curr)=>{
          return sum+curr.itemTotalMrp
        },0)

        const totalCouponDiscount=itemPriceDetails.reduce((sum,curr)=>{
          return sum+curr.itemTotalCouponDiscount
        },0)

        // const totalPrice=itemPriceDetails.reduce((sum,curr)=>{
        //   return sum+curr.itemTotalPrice
        // },0)

        const totalAmount=itemPriceDetails.reduce((sum,curr)=>{
          return sum+curr.itemTotalAmount
        },0)

        const totalOfferDiscount=totalMrp-totalPrice;

        // 5. Create order
        order.orderId=orderId;
        order.userId=userId;
        order.paymentMethod="Online Payment";
        order.paymentStatus="Pending";
        order.orderStatus=DELIVERY_STATUS.PENDING;
        order.orderItems=orderItems;
        order.totalMrp=totalMrp;
        order.totalCouponDiscount=totalCouponDiscount;
        order.totalOfferDiscount=totalOfferDiscount;
        order.totalPrice=totalPrice;
        order.totalAmount=totalAmount;

        await order.save();

        // Reduce stock
        for (let item of userCart.items) {
            await Product.findByIdAndUpdate(item.productId._id, {
                $inc: { quantity: -item.quantity }
            });
        }

         const options={
          amount:totalAmount*100,
          currency:"INR",
          receipt:orderId
        }

        const razorpayOrder =await razorpay.orders.create(options);
		    return res.json({razorpayOrder,teeSpaceOrderId:orderId});
        
      }
      

      const totalMrp=userCart.items.reduce((sum,item)=>{
        return sum+item.productId.regularPrice*item.quantity
      },0)

      const totalOfferDiscount=totalMrp-totalPrice;

       order.orderId=orderId;
        order.userId=userId;
        order.paymentMethod="Online Payment";
        order.paymentStatus="Pending";
        order.orderStatus=DELIVERY_STATUS.PENDING;
        order.totalMrp=totalMrp;
        // order.totalCouponDiscount=totalCouponDiscount;
        order.totalOfferDiscount=totalOfferDiscount;
        order.totalPrice=totalPrice;
        order.totalAmount=totalAmount;

        await order.save();

        // Reduce stock
        for (let item of userCart.items) {
            await Product.findByIdAndUpdate(item.productId._id, {
                $inc: { quantity: -item.quantity }
            });
        }

         const options={
          amount:totalAmount*100,
          currency:"INR",
          receipt:orderId
        }

        const razorpayOrder =await razorpay.orders.create(options);
		    return res.json({razorpayOrder,teeSpaceOrderId:orderId});
  } catch (error) {
    console.error("retryPayment() error=======",error)
    return res.status(Status.INTERNAL_ERROR).json({message:"Something went wrong"})
  }
}












const verifyRazorpayPayment = async (req,res)=>{
	try {
		const { razorpay_order_id, razorpay_payment_id, razorpay_signature ,teeSpaceOrderId} =req.body;
    const userId=req.session.user || req.session.passport?.user

    const order=await Order.findOne({userId,orderId:teeSpaceOrderId})
    if(!order) return res.status(Status.BAD_REQUEST).json({success:false,message:"Order not found, Please try again"})
    

		const sign = razorpay_order_id + "|" + razorpay_payment_id;
		const expectedSign = crypto
			.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
			.update(sign.toString())
			.digest("hex");

       // Optional: safer comparison
      const isValid = crypto.timingSafeEqual(
        Buffer.from(expectedSign, "utf8"),
        Buffer.from(razorpay_signature, "utf8")
      );

		if (!isValid) {
      const userCart=await Cart.findOne({userId}).populate("items.productId")

      // Reverse stock
      for (let item of userCart.items) {
          await Product.findByIdAndUpdate(item.productId._id, {
              $inc: { quantity: item.quantity }
          });
      }
      return res.status(Status.BAD_REQUEST).json({ success: false, message: "Payment verification failed." });
    }

     // Mark order as paid
    order.paymentStatus = "Paid";
    await order.save();

    const userCart=await Cart.findOne({userId})

    //check if any referral coupons
    //if yes, it should be removed, referral coupons are one time usable
    const allReferralCoupons=await Coupon.find({userId})
    const appliedRefCoupons=allReferralCoupons.filter((allC)=>{
      return userCart.appliedCoupons.some((uc)=>{
        return allC._id.toString()===uc.couponId.toString()
      })
    })

    const appliedRefCouponIds=appliedRefCoupons.map((c)=>{return c._id.toString()})

    await Coupon.deleteMany({userId,_id:{$in:appliedRefCouponIds}})
    

    //  Clear cart
    await Cart.updateOne({userId}, { $set: { items: [] ,appliedCoupons:[]} });

    return res.json({ success: true, message: "Payment verified successfully." ,orderId:teeSpaceOrderId});
	} catch (error) {
		console.log("verifyRazorpayPayment() error===>",error)
    return res.status(Status.INTERNAL_ERROR).json({
      success: false,
      message: "Something went wrong while verifying payment.",
    });
	}
}









const place_cod_order=async (req,res)=>{
    try {
        const userId=req.session.user || req.session.passport?.user;
        const {addressId,appliedCoupons=[]}=req.body;
        
        if(!userId)return res.status(Status.BAD_REQUEST).json({message:"session expired"})

        //  Fetch address and copy it
          const userAddressDoc = await Address.findOne(
              { userId, "address._id": addressId },
              { "address.$": 1 }
          );
          if (!userAddressDoc || userAddressDoc.address.length === 0) {
              return res.status(404).json({ success: false, message: "Address not found, Add a new address" });
          }
          const selectedAddress = userAddressDoc.address[0];
        
        // Fetch cart with product details, and product brand
        let userCart = await Cart.findOne({ userId })
          .populate({
            path: "items.productId",
            select: "productName productImage salePrice regularPrice brand quantity isBlocked category", // only the fields you need
            populate:[ 
            {
              path: "brand",
              select: "brandName",
            },
            {
              path:"category",
              select:"name"
            }
          ]
          })
    
        if(!userCart || userCart.items.length===0) return res.status(Status.BAD_REQUEST).json({status:false,message:"Cart is empty",reload:true})

        //validating all items in the cart
        const cartProductIds=userCart.items.map((item)=>{
            return item.productId._id
        })
        const validCartProducts=await Product.find({_id:{$in:cartProductIds}})
        const validCartProductsIds=validCartProducts.map((p)=>{return p._id.toString()})
    
        //returning only valid products to the user's cart,
        //removing the invalid products from user's cart
        userCart.items=userCart.items.filter((item)=>{
            return validCartProductsIds.includes(item.productId._id.toString())
        })
    
        //updating if any invalid products removed from user's cart
        if(userCart.items.length !== cartProductIds.length){
            return res.status(Status.BAD_REQUEST).json({message:"some products are invalid,please try again",reload:true})
        }
        
        let totalPrice=0;
        let totalAmount = 0;
        let isCartUpdated = false;//initially set as false.
        let anyOutOfStockProduct=false;



        // Check each item quantity vs stock
        for (const item of userCart.items) {
          //checking if any product is out of stock
            if(item.productId.quantity===0){
              anyOutOfStockProduct=true;
            }
          if (item.productId && item.quantity > item.productId.quantity) {
            item.quantity = item.productId.quantity; // reduce to available stock
            
            isCartUpdated = true;
          }
          totalPrice += (item.productId ? item.productId.salePrice : 0) * item.quantity;
          totalAmount += (item.productId ? item.productId.salePrice : 0) * item.quantity;
        }


        // If any change happened, save updated cart
        if (isCartUpdated) {
          await userCart.save();
          return res.status(Status.BAD_REQUEST).json({message:"Some products are few left or out of stock, Please re-check your cart",reload:true})
        }

        if(totalPrice===0){
          return res.status(Status.BAD_REQUEST).json({message:"Your cart is empty,re-check your cart and please try again",reload:true})
        }

        if(anyOutOfStockProduct){
          return res.status(Status.BAD_REQUEST).json({message:"There is 'out of stock' products, Please remove the 'out of stock' product(s)",reload:true})
        }

        if(userCart.appliedCoupons.length === 0 && totalAmount>1000){
          return res.status(Status.BAD_REQUEST).json({message:"Cash on Delivery is not available for order above Rs.1000/-",reload:true})
        }
        
        if(userCart.appliedCoupons.length > 0){
            if(appliedCoupons.length === userCart.appliedCoupons.length){
              //we have
              //appliedCoupon=[{},{}] from req.body
              //userCart.appliedCoupon=[{},{}]
              //checking both are matching and same
                const areCouponsMatch=userCart.appliedCoupons.every((userCartCoupon)=>{
                  return appliedCoupons.some((formDataCoupon)=>{
                    return (userCartCoupon.couponId.toString()===formDataCoupon.couponId &&
                    userCartCoupon.code===formDataCoupon.couponCode)
                  })
                })
                if(!areCouponsMatch){
                  userCart.appliedCoupons=[];
                  await userCart.save()
                  return res.status(Status.INTERNAL_ERROR).json({message:"Coupon mismatch, please try again",reload:true})
                }
            }else{
              userCart.appliedCoupons=[];
              await userCart.save()
              return res.status(Status.INTERNAL_ERROR).json({message:"Coupon mismatch, please try again",reload:true})
            }
          
            //checking coupons are valid, and available
            const appliedCouponIds=userCart.appliedCoupons.map((appliedCoupon)=>{
                return appliedCoupon.couponId;
            })

            //fetching all applied coupon's original doc with the coupon ids
            const now = new Date();
            const coupons = await Coupon.find({
                _id: { $in: appliedCouponIds },
                isActive: true,
                expiryDate: { $gt: now },
                startDate: { $lt: now }
            });
            if(appliedCouponIds.length !== coupons.length){
              return res.status(Status.BAD_REQUEST).json({message:"Some coupons are expired or unavailable, Please try again",reload:true})
            }

            //re-checking if cart total meeting minPurchase for coupon discount.every coupon has atleast 0 minPurchase
            const areCouponsMeetMinPurchase=coupons.every((coupon)=>{
              return coupon.minPurchase <= totalPrice
            })
            if(!areCouponsMeetMinPurchase){
              userCart.appliedCoupons=[];
              userCart.save()
              return res.status(Status.BAD_REQUEST).json({message:"Minimum Purchase required for the coupon, Please try again",reload:true})
            }

            //check if the product is valid category
            for(const coupon of coupons){
                if(coupon.isCategoryBased){
                const applicableCategoryIds = coupon.applicableCategories.map(applicableCatId => applicableCatId.toString());
                const hasApplicableProduct=userCart.items.some((item)=>{
                  return (item.productId?.category && applicableCategoryIds.includes(item.productId.category._id.toString()))
                })
                //if there is no applicable products, remove the coupon from user's cart
                    if(!hasApplicableProduct){
                      userCart.appliedCoupons=[]
                      await userCart.save();
                      return res.status(Status.BAD_REQUEST).json({message:"These product categories don't have this coupon discount, Please try again",reload:true})
                    }
                }
            }

            //calculate coupon discount
            const itemPriceDetails=[] //to store every products total amount and total discount
            for(const item of userCart.items){
              const itemTotalMrp=item.productId.regularPrice * item.quantity;
              const itemTotalPrice=item.productId.salePrice * item.quantity;
              let itemTotalCouponDiscount=0;
              for(const coupon of coupons){
                if(coupon.isCategoryBased){
                  //if the product is other category, skip this coupon application for that product
                  if(
                    !coupon.applicableCategories
                      .some((catId)=>{return catId.toString()=== item.productId.category._id.toString()})
                    ){
                      continue;
                    }

                    let discount=0;
                    if(coupon.discountType==="percentage"){
                      discount=(itemTotalPrice*coupon.discountValue)/100
                    }else{
                      //if fixed discount
                      discount=(itemTotalPrice/totalPrice)*coupon.discountValue
                    }

                    //cap max discount
                    if(coupon.maxDiscountAmount && discount> coupon.maxDiscountAmount){
                      discount=coupon.maxDiscountAmount;
                    }

                    itemTotalCouponDiscount+=discount;
                }else{//if coupon is not category based
                    let discount=0;
                  
                    if(coupon.discountType==="percentage"){
                      discount=(itemTotalPrice*coupon.discountValue)/100
                    }else{
                      //if fixed discount
                      discount=(itemTotalPrice/totalPrice)*coupon.discountValue
                    }

                    //cap max discount
                    if(coupon.maxDiscountAmount && discount> coupon.maxDiscountAmount){
                      discount=coupon.maxDiscountAmount;
                    }
                    itemTotalCouponDiscount+=discount;
                }
              }
              itemPriceDetails.push({
                productId:item.productId._id.toString(),
                itemTotalMrp:itemTotalMrp,
                itemTotalPrice:itemTotalPrice,
                itemTotalCouponDiscount:itemTotalCouponDiscount,
                itemTotalAmount:itemTotalPrice-itemTotalCouponDiscount
              })
            }

            //prepare order items obj with coupon discount
            const orderItems=userCart.items.map((item)=>{
              return {
                productId:item.productId._id.toString(),
                productName:item.productId.productName,
                productImage:item.productId.productImage[0].url,
                quantity:item.quantity,
                itemStatus:"Pending"
              }
            })

            // console.log("orderItems BEFORE===========>",orderItems)

            orderItems.forEach((o)=>{
              const itemPrices=itemPriceDetails.find((i)=>{ return i.productId === o.productId})
              o.mrp=itemPrices.itemTotalMrp;
              o.couponDiscount=itemPrices.itemTotalCouponDiscount;
              o.offerDiscount=itemPrices.itemTotalMrp-itemPrices.itemTotalPrice;
              o.price=itemPrices.itemTotalAmount
            })

            // const totalPrice=itemPriceDetails.reduce((sum,curr)=>{
            //   return sum+curr.itemTotalPrice
            // },0)

            const totalAmount=itemPriceDetails.reduce((sum,curr)=>{
              return sum+curr.itemTotalAmount
            },0)

            console.log("totalAmount after coupon application============",totalAmount)

            if(totalAmount>1000){
                return res.status(Status.BAD_REQUEST).json({message:"Cash on Delivery is not available for orders above Rs.1000/-",reload:true})
            }

            const totalMrp=itemPriceDetails.reduce((sum,curr)=>{
              return sum+curr.itemTotalMrp
            },0)

            const totalCouponDiscount=itemPriceDetails.reduce((sum,curr)=>{
              return sum+curr.itemTotalCouponDiscount
            },0)


            const totalOfferDiscount=totalMrp-totalPrice;


            //generate custom order ID
            const customOrderId = await getNextOrderId();

            // 5. Create order
            const newOrder = new Order({
                orderId: customOrderId,
                userId,
                shippingAddress: selectedAddress.toObject(),
                paymentMethod:"Cash on Delivery",
                paymentStatus: "Pending", // update after payment success
                orderStatus: "Pending",
                orderItems,
                totalMrp,
                totalOfferDiscount,
                totalCouponDiscount,
                totalPrice,
                totalAmount
            });

            // console.log("orderItems AFTER===========>",orderItems)
            // console.log("newOrder==========>",newOrder)
            await newOrder.save();


            // Reduce stock
            for (let item of userCart.items) {
                await Product.findByIdAndUpdate(item.productId._id, {
                    $inc: { quantity: -item.quantity }
                });
            }

            //check if any referral coupons
              //if yes, it should be removed, referral coupons are one time usable
              const allReferralCoupons=await Coupon.find({userId})
              const appliedRefCoupons=allReferralCoupons.filter((allC)=>{
                return userCart.appliedCoupons.some((uc)=>{
                  return allC._id.toString()===uc.couponId.toString()
                })
              })

              const appliedRefCouponIds=appliedRefCoupons.map((c)=>{return c._id.toString()})

              await Coupon.deleteMany({userId,_id:{$in:appliedRefCouponIds}})


            //  Clear cart
            const result = await Cart.updateOne({userId}, { $set: { items: [],appliedCoupons:[] } });
            // if (result.matchedCount === 0) {
            //   console.log("No document found to update");
            // } else if (result.modifiedCount === 0) {
            //   console.log("Document found but nothing was changed");
            // } else {
            //   console.log("Document updated successfully");
            // }
            // console.log("newOrder===>orderId====>",newOrder);

          return res.json({ success: true, message: "Order placed successfully", orderId: newOrder.orderId });

        }

        // Prepare order items with itemStatus
        const orderItems = userCart.items.map(item => ({
          productId: item.productId._id,
          productName: item.productId.productName,
          productImage: item.productId.productImage[0].url,
          quantity: item.quantity,
          mrp:item.productId.regularPrice * item.quantity,
          price: item.productId.salePrice*item.quantity,
          offerDiscount:(item.productId.regularPrice * item.quantity)-(item.productId.salePrice * item.quantity),
          itemStatus: "Pending" // 👈 every product starts as "Pending"
        }));

        const totalMrp=userCart.items.reduce((sum,item)=>{
          return sum+item.productId.regularPrice*item.quantity
        },0)

        const totalOfferDiscount=totalMrp-totalPrice;
        

        // 🔑 Generate custom order ID
        const customOrderId = await getNextOrderId();

        // 5. Create order
        const newOrder = new Order({
            orderId: customOrderId,
            userId,
            shippingAddress: selectedAddress.toObject(),
            paymentMethod:"Cash on Delivery",
            paymentStatus: "Pending", // update after payment success
            orderStatus: "Pending",
            orderItems,
            totalMrp,
            totalPrice,
            totalOfferDiscount,
            totalAmount
        });

        await newOrder.save();

        // 6. Reduce stock
        for (let item of userCart.items) {
            await Product.findByIdAndUpdate(item.productId._id, {
                $inc: { quantity: -item.quantity }
            });
        }

        // 7. Clear cart
        await Cart.updateOne({userId}, { $set: { items: [] ,appliedCoupons:[]} });
        // console.log("newOrder===>orderId====>",newOrder);

        res.json({ success: true, message: "Order placed successfully", orderId: newOrder.orderId });

    } catch (error) {
        console.error("orderController / place_cod_order() error:",error);

        return res.status(Status.INTERNAL_ERROR).json({
          success: false,
          message: "Something went wrong. Please try again later.",
          reload:true
        });

    }
}











const placeWalletPaidOrder = async (req,res)=>{
  try {
      const userId=req.session.user || req.session.passport?.user;
      const userWallet=await Wallet.findOne({userId})
      if(!userWallet)return res.status(Status.INTERNAL_ERROR).json({success:false,message:"Your wallet is not found"})

      const {addressId,appliedCoupons=[]}=req.body;

      // 2. Fetch address and copy it
      const userAddressDoc = await Address.findOne(
          { userId, "address._id": addressId },
          { "address.$": 1 }
      );
      if (!userAddressDoc || userAddressDoc.address.length === 0) {
          return res.status(404).json({ success: false, message: "Address not found" });
      }
      const selectedAddress = userAddressDoc.address[0];


      // Fetch cart with product details, and product brand
      let userCart = await Cart.findOne({ userId })
        .populate({
          path: "items.productId",
          select: "productName productImage salePrice regularPrice brand quantity isBlocked category", // only the fields you need
          populate:[ 
          {
            path: "brand",
            select: "brandName",
          },
          {
            path:"category",
            select:"name"
          }
        ]
        })

      if(!userCart || userCart.items.length===0) return res.status(Status.BAD_REQUEST).json({status:false,message:"Cart is empty",reload:true})

       //validating all items in the cart
      const cartProductIds=userCart.items.map((item)=>{
          return item.productId._id
      })
      const validCartProducts=await Product.find({_id:{$in:cartProductIds}})
      const validCartProductsIds=validCartProducts.map((p)=>{return p._id.toString()})
  
      //returning only valid products to the user's cart,
      //removing the invalid products from user's cart
      userCart.items=userCart.items.filter((item)=>{
          return validCartProductsIds.includes(item.productId._id.toString())
      })
  
      //updating if any invalid products removed from user's cart
      if(userCart.items.length !== cartProductIds.length){
          return res.status(Status.BAD_REQUEST).json({message:"some products are invalid,please try again",reload:true})
      }

      let totalPrice=0;
      let totalAmount = 0;
      let isCartUpdated = false;//initially set as false.
      let anyOutOfStockProduct=false;


      // Check each item quantity vs stock
      for (const item of userCart.items) {
        //checking if any product is out of stock
          if(item.productId.quantity===0){
            anyOutOfStockProduct=true;
          }

        if (item.productId && item.quantity > item.productId.quantity) {
          item.quantity = item.productId.quantity; // reduce to available stock
  
          isCartUpdated = true;
        }
        totalPrice += (item.productId ? item.productId.salePrice : 0) * item.quantity;
        totalAmount += (item.productId ? item.productId.salePrice : 0) * item.quantity;
      }


      // If any change happened, save updated cart
      if (isCartUpdated) {
        await userCart.save();
        return res.status(Status.BAD_REQUEST).json({message:"Some products are few left or out of stock, Please re-check your cart",reload:true})
      }

      if(totalPrice===0){
        return res.status(Status.BAD_REQUEST).json({message:"Your cart is empty,re-check your cart and please try again",reload:true})
      }

      if(anyOutOfStockProduct){
        return res.status(Status.BAD_REQUEST).json({message:"There is 'out of stock' products, Please remove 'out of stock' product(s)",reload:true})
      }

      if(userCart.appliedCoupons.length > 0){
            if(appliedCoupons.length === userCart.appliedCoupons.length){
              //we have
              //appliedCoupon=[{},{}] from req.body
              //userCart.appliedCoupon=[{},{}]
              //checking both are matching and same
                const areCouponsMatch=userCart.appliedCoupons.every((userCartCoupon)=>{
                  return appliedCoupons.some((formDataCoupon)=>{
                    return (userCartCoupon.couponId.toString()===formDataCoupon.couponId &&
                    userCartCoupon.code===formDataCoupon.couponCode)
                  })
                })
                if(!areCouponsMatch){
                  userCart.appliedCoupons=[];
                  await userCart.save()
                  return res.status(Status.INTERNAL_ERROR).json({message:"Coupon mismatch, please try again",reload:true})
                }
            }else{
              userCart.appliedCoupons=[];
              await userCart.save()
              return res.status(Status.INTERNAL_ERROR).json({message:"Coupon mismatch, please try again",reload:true})
            }
            
            //checking coupons are valid, and available
            const appliedCouponIds=userCart.appliedCoupons.map((appliedCoupon)=>{
                return appliedCoupon.couponId;
            })

            //fetching all applied coupon's original doc with the coupon ids
            const now = new Date();
            const coupons = await Coupon.find({
                _id: { $in: appliedCouponIds },
                isActive: true,
                expiryDate: { $gt: now },
                startDate: { $lt: now }
            });
            if(appliedCouponIds.length !== coupons.length){
              return res.status(Status.BAD_REQUEST).json({message:"Some coupons are expired or unavailable, Please try again",reload:true})
            }

            //re-checking if cart total meeting minPurchase for coupon discount.every coupon has atleast 0 minPurchase
            const areCouponsMeetMinPurchase=coupons.every((coupon)=>{
              return coupon.minPurchase <= totalPrice
            })
            if(!areCouponsMeetMinPurchase){
              userCart.appliedCoupons=[];
              userCart.save()
              return res.status(Status.BAD_REQUEST).json({message:"Minimum Purchase required for the coupon, Please try again",reload:true})
            }

            //this only work if the coupon is category based
            //check if the product is valid category
            for(const coupon of coupons){
              if(coupon.isCategoryBased){
              const applicableCategoryIds = coupon.applicableCategories.map(applicableCatId => applicableCatId.toString());
              const hasApplicableProduct=userCart.items.some((item)=>{
                return (item.productId?.category && applicableCategoryIds.includes(item.productId.category._id.toString()))
              })
              //if there is no applicable products, remove the coupon from user's cart
              if(!hasApplicableProduct){
                userCart.appliedCoupons=[]
                await userCart.save();
                return res.status(Status.BAD_REQUEST).json({message:"These product categories don't have this coupon discount, Please try again",reload:true})
              }
              }
            }

            //calculate coupon discount
            const itemPriceDetails=[] //to store every products total amount and total discount
            for(const item of userCart.items){
              const itemTotalMrp=item.productId.regularPrice * item.quantity;
              const itemTotalPrice=item.productId.salePrice * item.quantity;

              let itemTotalCouponDiscount=0;

              for(const coupon of coupons){
                if(coupon.isCategoryBased){
                  //if the product is other category, skip this coupon application for that product
                  if(
                    !coupon.applicableCategories
                      .some((catId)=>{return catId.toString()=== item.productId.category._id.toString()})
                    ){
                      continue;
                    }

                    let discount=0;
                    if(coupon.discountType==="percentage"){
                      discount=(itemTotalPrice*coupon.discountValue)/100
                    }else{
                      //if fixed discount
                      discount=(itemTotalPrice/totalPrice)*coupon.discountValue
                    }

                    //cap max discount
                    if(coupon.maxDiscountAmount && discount> coupon.maxDiscountAmount){
                      discount=coupon.maxDiscountAmount;
                    }

                    itemTotalCouponDiscount+=discount;
                }else{//if coupon is not category based
                    let discount=0;
                  
                    if(coupon.discountType==="percentage"){
                      discount=(itemTotalPrice*coupon.discountValue)/100
                    }else{
                      //if fixed discount
                      discount=(itemTotalPrice/totalPrice)*coupon.discountValue
                    }

                    //cap max discount
                    if(coupon.maxDiscountAmount && discount> coupon.maxDiscountAmount){
                      discount=coupon.maxDiscountAmount;
                    }
                    itemTotalCouponDiscount+=discount;
                }
              }
              itemPriceDetails.push({
                productId:item.productId._id.toString(),
                itemTotalMrp:itemTotalMrp,
                itemTotalPrice:itemTotalPrice,
                itemTotalCouponDiscount:itemTotalCouponDiscount,
                itemTotalAmount:itemTotalPrice-itemTotalCouponDiscount
              })
            }

            //prepare order items obj with coupon discount
            const orderItems=userCart.items.map((item)=>{
              return {
                productId:item.productId._id.toString(),
                productName:item.productId.productName,
                productImage:item.productId.productImage[0].url,
                quantity:item.quantity,
                itemStatus:"Pending"
              }
            })

            // console.log("orderItems BEFORE===========>",orderItems)

            orderItems.forEach((o)=>{
              const itemPrices=itemPriceDetails.find((i)=>{ return i.productId === o.productId})
              o.mrp=itemPrices.itemTotalMrp;
              o.couponDiscount=itemPrices.itemTotalCouponDiscount;
              o.offerDiscount=itemPrices.itemTotalMrp-itemPrices.itemTotalPrice;
              o.price=itemPrices.itemTotalAmount;
            })

            const totalAmount=itemPriceDetails.reduce((sum,curr)=>{
              return sum+curr.itemTotalAmount
            },0)

            if(totalAmount>userWallet.balance){
              return res.status(Status.BAD_REQUEST).json({message:"Not enough balance in your wallet",reload:true})
            }

            const totalMrp=itemPriceDetails.reduce((sum,curr)=>{
              return sum+curr.itemTotalMrp
            },0)

            const totalCouponDiscount=itemPriceDetails.reduce((sum,curr)=>{
              return sum+curr.itemTotalCouponDiscount
            },0)

            // const totalPrice=itemPriceDetails.reduce((sum,curr)=>{
            //   return sum+curr.itemTotalPrice
            // },0)

            const totalOfferDiscount=totalMrp-totalPrice;


            //generate custom order ID
            const customOrderId = await getNextOrderId();

            userWallet.balance-=totalAmount;
            userWallet.transactions.push({
              amount:totalAmount,
              type:"debit",
              description:`Paid for ${customOrderId}`
            })

            // 5. Create order
            const newOrder = new Order({
                orderId: customOrderId,
                userId,
                shippingAddress: selectedAddress.toObject(),
                paymentMethod:"TeeSpace Wallet",
                paymentStatus: "Paid",
                orderStatus: "Pending",
                orderItems,
                totalMrp,
                totalOfferDiscount,
                totalCouponDiscount,
                totalPrice,
                totalAmount
            });

            // console.log("orderItems AFTER===========>",orderItems)
            // console.log("newOrder==========>",newOrder)
            await newOrder.save();
            await userWallet.save();


            // Reduce stock
            for (let item of userCart.items) {
                await Product.findByIdAndUpdate(item.productId._id, {
                    $inc: { quantity: -item.quantity }
                });
            }

            //check if any referral coupons
              //if yes, it should be removed, referral coupons are one time usable
              const allReferralCoupons=await Coupon.find({userId})
              console.log("allReferralCoupons=======",allReferralCoupons)
              const appliedRefCoupons=allReferralCoupons.filter((allC)=>{
                return userCart.appliedCoupons.some((uc)=>{
                  return allC._id.toString()===uc.couponId.toString()
                })
              })

              console.log("appliedRefCoupons==============",appliedRefCoupons)

              const appliedRefCouponIds=appliedRefCoupons.map((c)=>{return c._id.toString()})
              console.log("appliedRefCouponIds",appliedRefCouponIds)

              const deleteResult=await Coupon.deleteMany({userId,_id:{$in:appliedRefCouponIds}})
              console.log("deleteResult===============",deleteResult)

            //  Clear cart
            const result = await Cart.updateOne({userId}, { $set: { items: [],appliedCoupons:[] } });
            // if (result.matchedCount === 0) {
            //   console.log("No document found to update");
            // } else if (result.modifiedCount === 0) {
            //   console.log("Document found but nothing was changed");
            // } else {
            //   console.log("Document updated successfully");
            // }
            // console.log("newOrder===>orderId====>",newOrder);

            return res.json({ success: true, message: "Order placed successfully", orderId: newOrder.orderId });
      }

      if(totalAmount>userWallet.balance){
          return res.status(Status.BAD_REQUEST).json({message:"Not enough balance in your wallet",reload:true})
      }

      // Prepare order items with itemStatus
        const orderItems = userCart.items.map(item => ({
          productId: item.productId._id,
          productName: item.productId.productName,
          productImage: item.productId.productImage[0].url,
          quantity: item.quantity,
          mrp:item.productId.regularPrice * item.quantity,
          price: item.productId.salePrice*item.quantity,
          offerDiscount:(item.productId.regularPrice * item.quantity)-(item.productId.salePrice * item.quantity),
          itemStatus: "Pending" // 👈 every product starts as "Pending"
        }));


        const totalMrp=userCart.items.reduce((sum,item)=>{
          return sum+item.productId.regularPrice*item.quantity
        },0)

        const totalOfferDiscount=totalMrp-totalPrice;


      // 🔑 Generate custom order ID
      const customOrderId = await getNextOrderId();

      userWallet.balance-=totalAmount;
      userWallet.transactions.push({
        amount:totalAmount,
        type:"debit",
        description:`Paid for ${customOrderId}`
      })

      // 5. Create order
      const newOrder = new Order({
          orderId: customOrderId,
          userId,
          shippingAddress: selectedAddress.toObject(),
          paymentMethod:"TeeSpace Wallet",
          paymentStatus: "Paid",
          orderStatus: "Pending",
          orderItems,
          totalMrp,
          totalPrice,
          totalOfferDiscount,
          totalAmount
      });

      await newOrder.save();

      // 6. Reduce stock
      for (let item of userCart.items) {
          await Product.findByIdAndUpdate(item.productId._id, {
              $inc: { quantity: -item.quantity }
          });
      }

      await userWallet.save();

      // 7. Clear cart
      const result = await Cart.updateOne({userId}, { $set: { items: [],appliedCoupons:[] } });
      // console.log("newOrder===>orderId====>",newOrder);

      return res.json({ success: true, message: "Order placed successfully", orderId: newOrder.orderId });
  } catch (error) {
      console.error("orderController / placeWalletPaidOrder() error:",error);
      return res.status(Status.INTERNAL_ERROR).json({
        success: false,
        message: "Something went wrong. Please try again later."
      });

  }
}










const showOrderSuccessPage=async (req,res)=>{
    try {
        const userId=req.session.user || req.session.passport?.user;
        const userData=await User.findById(userId)
        const order=await Order.findOne({orderId:req.params.orderId});
        if(!order) return res.redirect('/page-not-found')

        res.render('user/order-success',{
            title:"Order success",
            order,
            cartLength:null,
            user:userData

        })
    } catch (error) {
        console.log("showOrderSuccessPage() error====>",error);
        res.redirect("/page-not-found")
    }
}












const showOrders = async (req, res) => {
    try {
        const userId = req.session.user || req.session.passport?.user;
        const userData = await User.findById(userId);

        // Pagination
        const page = parseInt(req.query.page) || 1;  
        const limit = 2;  // orders per page
        const skip = (page - 1) * limit;

        // Search
        const searchQuery = req.query.search?.trim() || "";

        // Fetch orders
        const orders = await Order.find({ userId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        // Flatten items + add order-level info
        let orderItems = [];
        orders.forEach(order => {
            // ✅ Check if all items are still pending
            const allPending = order.orderItems.every(i => i.itemStatus === "Pending");

            // ✅ If even one is shipped/delivered, hide cancel-whole-order
            const anyShippedOrDelivered = order.orderItems.some(i =>
                ["Shipped", "Out for Delivery", "Delivered"].includes(i.itemStatus)
            );

            order.canCancelWholeOrder = allPending && !anyShippedOrDelivered;

            order.orderItems.forEach(item => {
                // Filter by search query
                if (
                    !searchQuery ||
                    order.orderId.toString().includes(searchQuery) ||
                    item.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    item.itemStatus.toLowerCase().includes(searchQuery.toLowerCase())
                ) {
                    orderItems.push({
                        orderId: order.orderId,
                        createdAt: order.createdAt,
                        orderStatus: order.orderStatus,
                        paymentMethod: order.paymentMethod,
                        totalAmount: order.totalAmount,
                        shippingAddress: order.shippingAddress,
                        item,
                        canCancelWholeOrder: order.canCancelWholeOrder   // ✅ pass flag
                    });
                }
            });
        });

        // Get total orders for pagination
        const totalOrders = await Order.countDocuments({ userId });
        const totalPages = Math.ceil(totalOrders / limit);

        res.render("user/profile/order/orders", {
            title: "My Orders",
            user: userData,
            cartLength: null,
            orderItems,
            currentPage: page,
            totalPages,
            searchQuery
        });

    } catch (error) {
        console.log("showOrders() error====>", error);
        res.redirect("/page-not-found");
    }
};









const showOrderDetails=async(req,res)=>{
    try {
        const userId=req.session.user || req.session.passport?.user;
        const userData=await User.findById(userId)

        const orderId = req.params.orderId;

        const order = await Order.findOne({ orderId, userId });
        if (!order) return res.redirect("/page-not-found");

        res.render("user/profile/order/order-details", {
        title: "Order Details",
        order,
        user:userData,
        cartLength:''
        });

    } catch (error) {
        console.log("showOrderDetails() error======>",error)
        res.redirect("/page-not-found")
    }
}








// helper
async function restoreStock(orderItems,reason) {
  console.log("orderItems===>",orderItems);
  const updates = orderItems
    .filter(item => item.itemStatus === "Pending")
    .map(item => {
      item.itemStatus = "Cancelled";
      item.cancelReason=reason;
      return Product.findByIdAndUpdate(item.productId, {
        $inc: { quantity: item.quantity }
      });
    });

  return Promise.all(updates);
}






// Cancel a single product in an order
const cancelOrderItem = async (req, res) => {
  try {
    const userId = req.session.user || req.session.passport?.user;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Login required" });
    }

    const { orderId, itemId, reason } = req.body;

    const order = await Order.findOne({ orderId, userId });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const item = order.orderItems.id(itemId); // find subdocument
    if (!item) {
      return res.status(404).json({ success: false, message: "Item not found" });
    }

    if (item.itemStatus !== "Pending") {
      return res.status(Status.BAD_REQUEST).json({ success: false, message: "Item cannot be cancelled at this stage" });
    }

    //  Restore stock
    await restoreStock([item],reason);

    //  Update item refund status (only if paid & online)
    if (order.paymentMethod === "Online Payment" && order.paymentStatus === "Paid") {
      item.refundStatus = "Refunded";
      item.refundedOn=new Date();
    }

    if(order.paymentMethod === "TeeSpace Wallet" && order.paymentStatus === "Paid"){
      const userWallet=await Wallet.findOne({userId})
      userWallet.balance+=item.price;
      userWallet.transactions.push({
        amount:item.price,
        type:"credit",
        description:`Refund for ${item.productName} (Order ${order.orderId})`
      });
      await userWallet.save();
      item.refundStatus = "Refunded";
      item.refundedOn = new Date();
    }


    const allStatuses = order.orderItems.map(i => i.itemStatus);
    const allStatusSet=new Set(allStatuses)

    if(allStatusSet.size===1 && allStatusSet.has("Cancelled")){
      order.orderStatus = "Cancelled"
    }
    if(allStatusSet.size===1 && allStatusSet.has("Delivered")){
      order.orderStatus = "Delivered";
      order.deliveredOn=new Date();
    }
    if(allStatusSet.size===2 && allStatusSet.has('Delivered') && allStatusSet.has("Cancelled")){
      order.orderStatus="Delivered";

      const deliveredDates=order.orderItems
          .map((item)=>item.deliveredOn)
          .filter((date)=>date)
      deliveredDates.sort((a,b)=>a-b);
      const latestDeliveredDate=deliveredDates[deliveredDates.length-1];

      order.deliveredOn=latestDeliveredDate;
    }


    // //  Update order status
    // const allCancelled = order.orderItems.every(i => i.itemStatus === "Cancelled");
    // const someCancelled = order.orderItems.some(i => i.itemStatus === "Cancelled");

    // if (allCancelled) {
    //   order.orderStatus = "Cancelled";
    // } else if (someCancelled) {
    //   order.orderStatus = "Partially Cancelled";
    // }

    //  Update order refund summary
    const allRefunded = order.orderItems.every(i => i.refundStatus === "Refunded");
    const someRefunded = order.orderItems.some(i => i.refundStatus === "Refunded");

    if (allRefunded) {
      order.refundStatus = "Refunded";
    } else if (someRefunded) {
      order.refundStatus = "Partially Refunded";
    }

    const refundAmount = item.price;
    const offerDiscount=item.offerDiscount;
    const couponDiscount=item.couponDiscount;

    order.totalMrp-=item.mrp;
    order.totalPrice-=(refundAmount+offerDiscount);
    order.totalAmount-=refundAmount;
    order.totalOfferDiscount-=offerDiscount;
    order.totalCouponDiscount-=couponDiscount;


    await order.save();

    res.json({ success: true, message: "Item cancelled successfully" });

  } catch (error) {
    console.log("cancelOrderItem() error =>", error);
    res.status(Status.INTERNAL_ERROR).json({ success: false, message: "Something went wrong" });
  }
};







// Cancel entire order
const cancelWholeOrder = async (req, res) => {
  try {
    const userId = req.session.user || req.session.passport?.user;
    if (!userId) return res.status(401).json({ success: false, message: "Login required" });

    const { orderId ,reason} = req.body;

    const order = await Order.findOne({ orderId, userId });
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    // Block cancellation if shipped/delivered items exist
    if (order.orderItems.some(i => ["Shipped", "Delivered"].includes(i.itemStatus))) {
      return res.status(Status.BAD_REQUEST).json({
        success: false,
        message: "Some items are already shipped/delivered. Order cannot be cancelled."
      });
    }

    // Allow cancel only if order is in these statuses
    if (!["Pending", "Partially Cancelled"].includes(order.orderStatus)) {
      return res.status(Status.BAD_REQUEST).json({ success: false, message: "Order cannot be cancelled at this stage" });
    }

    const pendingItems=order.orderItems.filter((item)=>{
      return item.itemStatus==="Pending"
    })

    let totalMrpOfPendingItems=0;
    let totalOfferDiscountOfPendingItems=0;
    let totalCouponDiscountOfPendingItems=0;
    let totalPriceOfPendingItems=0;
    let totalAmountOfPendingItems=0;

    pendingItems.forEach((item)=>{
      totalMrpOfPendingItems+=item.mrp;
      totalOfferDiscountOfPendingItems+=item.offerDiscount;
      totalCouponDiscountOfPendingItems+=item.couponDiscount;
      totalPriceOfPendingItems+=(item.price+item.offerDiscount);
      totalAmountOfPendingItems+=item.price;
    })

    order.totalMrp-=totalMrpOfPendingItems;
    order.offerDiscount-=totalOfferDiscountOfPendingItems;
    order.totalCouponDiscount-=totalCouponDiscountOfPendingItems;
    order.totalPrice-=totalPriceOfPendingItems;
    order.totalAmount-=totalAmountOfPendingItems;


    // Restore stock and change status to "cancelled" for all Pending items,
    await restoreStock(order.orderItems,reason);

    // Track total refunded (for wallet)
    let totalWalletRefund = 0;

    // Loop through each item
    order.orderItems.forEach(item => {
      if (item.itemStatus === "Cancelled") {
        if (order.paymentMethod === "Online Payment" && order.paymentStatus === "Paid") {
          item.refundStatus = "Refunded";
          item.refundedOn = new Date();
        } else if (order.paymentMethod === "Cash on Delivery") {
          item.refundStatus = "Not Initiated";
        } else if (order.paymentMethod === "TeeSpace Wallet" && order.paymentStatus === "Paid") {
          if (item.refundStatus !== "Refunded") {
            totalWalletRefund += item.price;
            item.refundStatus = "Refunded";
            item.refundedOn = new Date();
          }
        }
      }
    });

    // Refund wallet if needed
    if (totalWalletRefund > 0) {
      const userWallet = await Wallet.findOne({ userId });
      if (userWallet) {
        userWallet.balance += totalWalletRefund;
        userWallet.transactions.push({
          type: "credit",
          amount: totalWalletRefund,
          description: `Refund for cancelled order ${order.orderId}`,
          createdAt: new Date()
        });
        await userWallet.save();
      }
    }



    // Determine order-level status
    const allStatuses = order.orderItems.map(i => i.itemStatus);
    const anyRefunded = order.orderItems.some(i => i.refundStatus === "Refunded");


    if (allStatuses.every(s => s === "Cancelled")) {
        order.orderStatus = "Cancelled";
        order.refundStatus = anyRefunded ? "Refunded" : "Not Initiated";
    }

    if(allStatuses.includes('Delivered')){
        order.orderStatus = "Delivered";

        const deliveredDates=order.orderItems
            .map((item)=>item.deliveredOn)
            .filter((date)=>date)
        deliveredDates.sort((a,b)=>a-b);
        const latestDeliveredDate=deliveredDates[latestDeliveredDate.length-1];
        order.deliveredOn=latestDeliveredDate;
    }

    await order.save();

    res.json({
      success: true,
      message: "Order cancelled successfully",
      refundedAmount: totalWalletRefund > 0 ? totalWalletRefund : undefined
    });

  } catch (error) {
    console.error("cancelWholeOrder() error =>", error);
    res.status(Status.INTERNAL_ERROR).json({ success: false, message: "Something went wrong" });
  }
};







const getInvoice = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate("userId");k
    
    if (!order) return res.status(404).send("Order not found");
    if (!order.invoice?.generated) return res.status(Status.BAD_REQUEST).send("Invoice not generated yet");

    // Set response headers
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=invoice-${order.invoice.number}.pdf`);

    // Create PDF
    const doc = new PDFDocument();
    doc.pipe(res);

    // Header
    doc.fontSize(18).text("Invoice", { align: "center" });
    doc.moveDown();

    // Invoice info
    doc.fontSize(12).text(`Invoice Number: ${order.invoice.number}`);
    doc.text(`Invoice Date: ${order.invoice.date.toDateString()}`);
    doc.text(`Order ID: ${order.orderId}`);
    doc.moveDown();

    // Buyer info
    doc.text(`Customer: ${order.userId.name}`);
    doc.text(`Shipping Address: ${order.shippingAddress.street}, ${order.shippingAddress.city}`);
    doc.moveDown();

    // Items
    doc.text("Items:");
    order.orderItems.forEach(item => {
      doc.text(`${item.productName} - Qty: ${item.quantity} - Price: ₹${item.price}`);
    });
    doc.moveDown();

    // Total
    doc.fontSize(14).text(`Total Amount: ₹${order.totalAmount}`, { align: "right" });

    // End and send
    doc.end();
  } catch (error) {
    console.error("getInvoice error:", error);
    res.status(Status.INTERNAL_ERROR).send("Internal server error");
  }
};





const returnOrderItem = async (req, res) => {
  try {
    const { orderId, itemId, reason } = req.body;
    const userId = req.session.user || req.session.passport?.user;

    const order = await Order.findOne({ orderId, userId });
    if (!order) return res.json({ success: false, message: "Order not found" });

    const item = order.orderItems.id(itemId);
    if (!item) return res.json({ success: false, message: "Item not found" });

    if (item.itemStatus !== "Delivered") {
      return res.json({ success: false, message: "Only delivered items can be returned" });
    }

    
    item.returnStatus = "Requested";
    item.returnReason = reason;
    item.returnRequestedAt = new Date();

    await order.save();

    // You could also notify admin/seller here
    res.json({ success: true, message: "Return request submitted" });
  } catch (error) {
    console.error("returnOrderItem() error:", error.message, error.stack);
    res.json({ success: false, message: "Something went wrong" });
  }
};





module.exports={
    createRazorPayOrder,
	  verifyRazorpayPayment,
    razorpayPaymentFailure,
    showOrderFailurePage,
    cancelFailedOrder,
    retryPayment,
    place_cod_order,
    placeWalletPaidOrder,
    showOrders,
    showOrderSuccessPage,
    showOrderDetails,
    cancelOrderItem,
    cancelWholeOrder,
    getInvoice,
    returnOrderItem
}

