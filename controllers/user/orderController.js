import dotenv from "dotenv";
dotenv.config();
import STATUS_CODES from '../../constants/statusCodes.js';
import DELIVERY_STATUS from '../../constants/deliveryStatus.enum.js';
import Cart from '../../models/cartSchema.js';
import Address from '../../models/addressSchema.js';
import Product from '../../models/productSchema.js';
import Order from '../../models/orderSchema.js';
import getNextOrderId from '../../utils/orderIdGenerator.js';
import User from '../../models/userSchema.js';
import PDFDocument from 'pdfkit';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import Wallet from '../../models/walletSchema.js';
import Coupon from '../../models/couponSchema.js';
import mongoose from 'mongoose';
import passport from 'passport';
const {session}=passport

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
        if(!userId)return res.status(STATUS_CODES.BAD_REQUEST).json({message:"session expired"})

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
    
      if(!userCart || userCart.items.length===0) return res.status(STATUS_CODES.BAD_REQUEST).json({status:false,message:"Cart is empty",reload:true})

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
          return res.status(STATUS_CODES.BAD_REQUEST).json({message:"some products are invalid,please try again",reload:true})
      }

      let totalPrice=0;
      let totalAmount = 0;
      let isCartUpdated = false;//initially set as false.
      let anyOutOfStockProduct=false;
      let anyZeroCountProduct=false;
      let anyUnavailableProduct=false;


      // Check each item quantity vs stock
      for (const item of userCart.items) {
         //checking if any product is out of stock
          if(item.productId.quantity===0){
            anyOutOfStockProduct=true;
          }
          if(item.quantity===0){
            anyZeroCountProduct=true;
          }
          if(item.productId.isBlocked){
            anyUnavailableProduct=true;
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
        return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Some products are few left or out of stock, Please re-check your cart",reload:true})
      }

      if(totalPrice===0){
        return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Your cart is empty,re-check your cart and please try again",reload:true})
      }

      if(anyOutOfStockProduct){
        return res.status(STATUS_CODES.BAD_REQUEST).json({message:"'Out of stock' product(s) in your cart, Please remove 'out of stock' product(s)",reload:true})
      }

      if(anyZeroCountProduct){
        return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Product(s) with zero buying count in your cart, Please increase the buying count"})
      }
      
      if(anyUnavailableProduct){
        return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Unavailable product(s) in your cart",reload:true})
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
                        return (userCartCoupon.couponId.toString()===formDataCoupon.couponId.toString() &&
                                userCartCoupon.code===formDataCoupon.couponCode)
                        })
				})
				if(!areCouponsMatch){
                    userCart.appliedCoupons=[];
                    await userCart.save()
                    return res.status(STATUS_CODES.INTERNAL_ERROR).json({message:"Coupon mismatch, please try again",reload:true})
				}
			}else{
                userCart.appliedCoupons=[];
                await userCart.save()
                return res.status(STATUS_CODES.INTERNAL_ERROR).json({message:"Coupon mismatch, please try again",reload:true})
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
			    return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Some coupons are expired or unavailable, Please try again",reload:true})
			}

			//re-checking if cart total meeting minPurchase for coupon discount.every coupon has atleast 0 minPurchase
			const areCouponsMeetMinPurchase=coupons.every((coupon)=>{
			    return coupon.minPurchase <= totalPrice
			})
			if(!areCouponsMeetMinPurchase){
                userCart.appliedCoupons=[];
                userCart.save()
                return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Minimum Purchase required for the coupon, Please try again",reload:true})
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
                        return res.status(STATUS_CODES.BAD_REQUEST).json({message:"These product categories don't have this coupon discount, Please try again",reload:true})
                    }
                }
			}

			//all set
			//calculate coupon discount
			

			const itemPriceDetails=[] //to store every product's total amount and total discount
			const appliedCouponsMap=new Map()
			

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

						if(!appliedCouponsMap.has(coupon.couponCode)){
                            appliedCouponsMap.set(
                                coupon.couponCode,
                                {
                                    couponId:coupon._id,
                                    discountType:coupon.discountType,
                                    discountValue:coupon.discountValue,
                                    minPurchase:coupon.minPurchase,
                                    maxDiscountAmount:coupon.maxDiscountAmount,
                                    isCategoryBased:coupon.isCategoryBased,
                                    applicableCategories:coupon.applicableCategories,
                                    excludeCategories:coupon.excludedCategories
                                }
							)
						}

						// appliedCoupons.push({
						//   discountType:coupon.discountType,
						//   discountValue:coupon.discountValue,
						//   minPurchase:coupon.minPurchase,
						//   maxDiscountAmount:coupon.maxDiscountAmount,
						//   isCategoryBased:coupon.isCategoryBased,
						//   applicableCategories:coupon.applicableCategories,
						//   excludeCategories:coupon.excludedCategories

						// })
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

						if(!appliedCouponsMap.has(coupon.couponCode)){
                            appliedCouponsMap.set(
                                coupon.couponCode,
                                {
                                    couponId:coupon._id,
                                    discountType:coupon.discountType,
                                    discountValue:coupon.discountValue,
                                    minPurchase:coupon.minPurchase,
                                    maxDiscountAmount:coupon.maxDiscountAmount,
                                    isCategoryBased:coupon.isCategoryBased,
                                    applicableCategories:coupon.applicableCategories,
                                    excludeCategories:coupon.excludedCategories
                                }
                            )
						}

						// appliedCoupons.push({
						//   discountType:coupon.discountType,
						//   discountValue:coupon.discountValue,
						//   minPurchase:coupon.minPurchase,
						//   maxDiscountAmount:coupon.maxDiscountAmount,
						//   isCategoryBased:coupon.isCategoryBased,
						//   applicableCategories:coupon.applicableCategories,
						//   excludeCategories:coupon.excludedCategories

						// })
					}
				}
				itemPriceDetails.push({
					productId:item.productId._id.toString(),
					itemMrp:item.productId.regularPrice,
					itemTotalMrp:itemTotalMrp,
					itemPrice:item.productId.salePrice,
					itemTotalPrice:itemTotalPrice,
					itemTotalCouponDiscount:itemTotalCouponDiscount,
					itemTotalAmount:itemTotalPrice-itemTotalCouponDiscount
				})
			}


			//appliedCoupons=req.body.appliedCoupons , which contians coupon codes and coupon IDs.
			//from now on, appliedCoupons[] will be filled with :applied coupon discount, discount type, discountValue, minimumPurchase amount
			// for managing the refund calculation when user cancelling the order, and returning the order in the future
			appliedCoupons.length=0;

			for(const [key,value] of appliedCouponsMap){
			    appliedCoupons.push(value)
			}
            // console.log("appliedcoupons =====", appliedCoupons)

			//prepare order items obj with coupon discount
			const orderItems=userCart.items.map((item)=>{
			// console.log("item===============",item)
                return {
                    productId:item.productId._id.toString(),
                    categoryId:item.productId.category._id.toString(),
                    productName:item.productId.productName,
                    productImage:item.productId.productImage[0].url,
                    quantity:item.quantity,
                    itemStatus:DELIVERY_STATUS.PENDING
                }
			})

			// // console.log("orderItems BEFORE===========>",orderItems)

			orderItems.forEach((o)=>{
				const itemPrices=itemPriceDetails.find((i)=>{ return i.productId === o.productId})
				o.mrp=itemPrices.itemMrp;
				o.totalMrp=itemPrices.itemTotalMrp;
				o.couponDiscount=itemPrices.itemTotalCouponDiscount;
				o.offerDiscount=itemPrices.itemTotalMrp-itemPrices.itemTotalPrice;
				o.salePrice=itemPrices.itemPrice,
				o.totalSalePrice=itemPrices.itemTotalPrice;
				o.price=itemPrices.itemTotalAmount;
				o.finalPaidAmount=itemPrices.itemTotalAmount;
				o.finalCouponDiscount=itemPrices.itemTotalCouponDiscount

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
				finalTotalOfferDiscount:totalOfferDiscount,
				totalCouponDiscount,
				finalTotalCouponDiscount:totalCouponDiscount,
				appliedCoupons,
				isCouponApplied:appliedCoupons.length > 0 ? true:false,
				totalPrice,
				finalTotalPrice:totalPrice,
				totalAmount,
				finalTotalAmount:totalAmount
			});

            // console.log("newOrder ===", newOrder.appliedCoupons)

			await newOrder.save();

			
			// console.log("totalAmount============",totalAmount)

			const options={
			amount:Math.round(totalAmount) * 100,
			currency:"INR",
			receipt:customOrderId
			}

			const order =await razorpay.orders.create(options);
			return res.json({order,teeSpaceOrderId:customOrderId});
      	}

		//if there is no applied coupon
      // Prepare order items with itemStatus
      const orderItems = userCart.items.map(item => ({
			productId: item.productId._id,
			categoryId:item.productId.category._id.toString(),
			productName: item.productId.productName,
			productImage: item.productId.productImage[0].url,
			quantity: item.quantity,
			mrp:item.productId.regularPrice,
			totalMrp:item.productId.regularPrice * item.quantity,
			salePrice:item.productId.salePrice,
			totalSalePrice:item.productId.salePrice * item.quantity,
			price: item.productId.salePrice*item.quantity,
			finalPaidAmount:item.productId.salePrice*item.quantity,
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
		  finalTotalPrice:totalPrice,
          totalOfferDiscount,
		  finalTotalOfferDiscount:totalOfferDiscount,
          totalAmount,
		  finalTotalAmount:totalAmount
      });

      await newOrder.save();

      // // 6. Reduce stock
      // for (let item of userCart.items) {
      //     await Product.findByIdAndUpdate(item.productId._id, {
      //         $inc: { quantity: -item.quantity }
      //     });
      // }

      // 7. Clear cart
      // await Cart.updateOne({userId}, { $set: { items: [] ,appliedCoupons:[]} });
      // console.log("newOrder===>orderId====>",newOrder);

      const options={
        amount:Math.round(totalAmount) * 100,
        currency:"INR",
        receipt:customOrderId
      }
      console.log("option.amount=====>",options.amount)
      const order =await razorpay.orders.create(options);
      res.json({order,teeSpaceOrderId:customOrderId});
	} catch (error) {
		console.log("createRazorPayOrder() error=====>",error);

		// ❌ Unknown/internal error
		return res.status(STATUS_CODES.INTERNAL_ERROR).json({
		success: false,
		message: "Something went wrong. Please try again later."
		});
	}
}









// const razorpayPaymentFailure=async (req,res)=>{
//   try {
//     const {razorpay_order_id, razorpay_payment_id, error_reason, appOrderId} = req.body;
//     await Order.updateOne(
//       {orderId:appOrderId},
//       {
//         paymentStatus:"Failed",
//         razorPayOrderId:razorpay_order_id,
//         razorPayPaymentId:razorpay_payment_id,
//         razorPayFailureReason:error_reason
//       }
//     )
//     res.json({success:true})
//   } catch (error) {
//     console.error("razorpayPaymentFailure() error========",error);
//     return res.status(STATUS_CODES.INTERNAL_ERROR).json({message:"Something went wrong"})
//   }
// }
const razorpayPaymentFailure=async (req,res)=>{
  try {
    const {razorpay_order_id, razorpay_payment_id, error_reason, appOrderId} = req.body;
    const order=await Order.findOne({orderId:appOrderId})

    for(const item of order.orderItems){
        item.itemStatus=DELIVERY_STATUS.PAYMENT_FAILED;
    }

    order.paymentStatus="Failed";
    order.orderStatus=DELIVERY_STATUS.PAYMENT_FAILED;
    order.razorPayOrderId=razorpay_order_id;
    order.razorPayPaymentId=razorpay_payment_id;
    order.razorPayFailureReason=error_reason;

    await order.save();
    res.json({success:true})
  } catch (error) {
    console.error("razorpayPaymentFailure() error========",error);
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({message:"Something went wrong"})
  }
}








const showOrderFailurePage=async(req,res)=>{
  try {
    //user can retry the payment from two pages, which are 'checkout' page, and 'order-details' page
    //if user is retrying payment from the 'order-details' page,
    //the 'order-failed' page shouldn't have the 'go to checkout' button
    const {accessToCheckoutPage}=req.query;
    console.log("accessToChekcoutPage == ",accessToCheckoutPage)
    const userId=req.session.user || req.session.passport?.user;
    const userData=await User.findById(userId)
    const order=await Order.findOne({orderId:req.params.orderId})

    res.render('user/order-failure',{
      title:"Order Failed",
      order,
      razorPayKeyId:process.env.RAZORPAY_KEY_ID,
      user:userData,
      cartLength:null,
      showCheckoutPageLink:accessToCheckoutPage? false:true
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
    

    return res.json({success:true})
  } catch (error) {
    console.error("cancelFailedOrder() error=========",error)
    return res.status(STATUS_CODES.INTERNAL_ERROR).json({message:"Something went wrong"})
  }
}










//in this function, we are recreating the razorpay order
const retryPayment=async (req,res)=>{
  try {
    const {orderId}=req.body;
    if(!orderId){
      return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Order not found",redirectToCheckoutPage:true})
    }

	const userId=req.session.user || req.session.passport?.user;
    const order=await Order.findOne({orderId})
    if(!order){
      return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Order not found",redirectToCheckoutPage:true})
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
    
      if(!userCart || userCart.items.length===0) return res.status(STATUS_CODES.BAD_REQUEST).json({status:false,message:"Cart is empty",redirectToCheckoutPage:true})

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
            return res.status(STATUS_CODES.BAD_REQUEST).json({message:"some products are invalid,please try again",redirectToCheckoutPage:true})
        }

        let totalPrice=0;
        let totalAmount = 0;
        let isCartUpdated = false;//initially set as false.
        let anyOutOfStockProduct=false;
        let anyZeroCountProduct=false;
        let anyUnavailableProduct=false




      // Check each item quantity vs stock
      for (const item of userCart.items) {
        //checking if any product is out of stock
          if(item.productId.quantity===0){
            anyOutOfStockProduct=true;
          }
          //checkin if any product has zero buying quantity
          if(item.quantity===0){
            anyZeroCountProduct=true;
          }
           if(item.productId.isBlocked){
            anyUnavailableProduct=true;
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
        return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Some products are few left or out of stock, Please re-check your cart",redirectToCheckoutPage:true})
      }

      if(totalPrice===0){
        return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Your cart is empty,re-check your cart and please try again",redirectToCheckoutPage:true})
      }

      if(anyOutOfStockProduct){
        return res.status(STATUS_CODES.BAD_REQUEST).json({message:"There is 'out of stock' products, Please remove 'out of stock' product(s)",reload:true})
      }

      if(anyZeroCountProduct){
        return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Product(s) with zero buying count in your cart, Please increase the buying count"})
      }

      if(anyUnavailableProduct){
        return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Unavailable product(s) in your cart",reload:true})
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
			    return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Some coupons are expired or unavailable, Please try again",redirectToCheckoutPage:true})
			}

			//re-checking if cart total meeting minPurchase for coupon discount.every coupon has atleast 0 minPurchase
			const areCouponsMeetMinPurchase=coupons.every((coupon)=>{
			    return coupon.minPurchase <= totalPrice
			})
			if(!areCouponsMeetMinPurchase){
          userCart.appliedCoupons=[];
          userCart.save()
          return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Minimum Purchase required for the coupon, Please try again",redirectToCheckoutPage:true})
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
                return res.status(STATUS_CODES.BAD_REQUEST).json({message:"These product categories don't have this coupon discount, Please try again",redirectToCheckoutPage:true})
              }
          }
			}


			//all set
			//calculate coupon discount


			const itemPriceDetails=[] //to store every product's total amount and total discount
			const appliedCouponsMap=new Map()


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


						if(!appliedCouponsMap.has(coupon.couponCode)){
							appliedCouponsMap.set(
							coupon.couponCode,
							{
								couponId:coupon._id,
								discountType:coupon.discountType,
								discountValue:coupon.discountValue,
								minPurchase:coupon.minPurchase,
								maxDiscountAmount:coupon.maxDiscountAmount,
								isCategoryBased:coupon.isCategoryBased,
								applicableCategories:coupon.applicableCategories,
								excludeCategories:coupon.excludedCategories
							}
						)
						}

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

						if(!appliedCouponsMap.has(coupon.couponCode)){
							appliedCouponsMap.set(
							coupon.couponCode,
							{

								couponId:coupon._id,
								discountType:coupon.discountType,
								discountValue:coupon.discountValue,
								minPurchase:coupon.minPurchase,
								maxDiscountAmount:coupon.maxDiscountAmount,
								isCategoryBased:coupon.isCategoryBased,
								applicableCategories:coupon.applicableCategories,
								excludeCategories:coupon.excludedCategories
							}
						)
						}

					}
				}
				itemPriceDetails.push({
					productId:item.productId._id.toString(),
					itemMrp:item.productId.regularPrice,
					itemTotalMrp:itemTotalMrp,
					itemPrice:item.productId.salePrice,
					itemTotalPrice:itemTotalPrice,
					itemTotalCouponDiscount:itemTotalCouponDiscount,
					itemTotalAmount:itemTotalPrice-itemTotalCouponDiscount
				})
			}


			//prepare order items obj with coupon discount
			const orderItems=userCart.items.map((item)=>{
			return {
				productId:item.productId._id.toString(),
				categoryId:item.productId.category._id.toString(),
				productName:item.productId.productName,
				productImage:item.productId.productImage[0].url,
				quantity:item.quantity,
				itemStatus:DELIVERY_STATUS.PENDING
			}
			})

			orderItems.forEach((o)=>{
				const itemPrices=itemPriceDetails.find((i)=>{ return i.productId === o.productId})
				o.mrp=itemPrices.itemMrp;
				o.totalMrp=itemPrices.itemTotalMrp;
				o.couponDiscount=itemPrices.itemTotalCouponDiscount;
				o.offerDiscount=itemPrices.itemTotalMrp-itemPrices.itemTotalPrice;
				o.salePrice=itemPrices.itemPrice
				o.totalSalePrice=itemPrices.itemTotalPrice;
				o.price=itemPrices.itemTotalAmount;
				o.finalPaidAmount=itemPrices.itemTotalAmount;
				o.finalCouponDiscount=itemPrices.itemTotalCouponDiscount

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
			order.finalTotalCouponDiscount=totalCouponDiscount;
			order.appliedCoupons=[...appliedCouponsMap.values()]
			order.isCouponApplied=[...appliedCouponsMap.values()].length > 0 ? true : false;
			order.totalOfferDiscount=totalOfferDiscount;
			order.finalTotalOfferDiscount=totalOfferDiscount;
			order.totalPrice=totalPrice;
			order.finalTotalPrice=totalPrice;
			order.totalAmount=totalAmount;
			order.finalTotalAmount=totalAmount

			await order.save();

			

			const options={
				amount:Math.round(totalAmount) * 100,
				currency:"INR",
				receipt:orderId
			}

			const razorpayOrder =await razorpay.orders.create(options);
			return res.json({razorpayOrder,teeSpaceOrderId:orderId});
        
    	}
	  ////////////////////////////////
      

		//if there is no applied coupons
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
		order.totalOfferDiscount=totalOfferDiscount;
		order.finalTotalOfferDiscount=totalOfferDiscount;
		order.totalPrice=totalPrice;
		order.finalTotalPrice=totalPrice;
		order.totalAmount=totalAmount;
		order.finalTotalAmount=totalAmount;

		await order.save();

       

         const options={
			amount:Math.round(totalAmount) * 100,
			currency:"INR",
			receipt:orderId
        }

        const razorpayOrder =await razorpay.orders.create(options);
		return res.json({razorpayOrder,teeSpaceOrderId:orderId});
	} catch (error) {
			console.error("retryPayment() error=======",error)
			return res.status(STATUS_CODES.INTERNAL_ERROR).json({message:"Something went wrong"})
	}
}









const retryPaymentFromOrderDetailsPage=async (req,res)=>{
	try {
		const {orderId}=req.body;
		if(!orderId){
			return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Order not found",redirectToCheckoutPage:true})
		}

		const userId=req.session.user || req.session.passport?.user;
		const order=await Order.findOne({orderId})
			.populate({
				path:"orderItems.productId",
				populate:[
						{
							path:"category"
						}
					]
			})
		if(!order){
			return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Order not found",redirectToCheckoutPage:true})
		}

		//validate all items in the order
		const orderItemsIds=order.orderItems.map(item=>item.productId)
		const validProducts=await Product.find({_id:{$in:orderItemsIds}})

		if(orderItemsIds.length !== validProducts.length){
			return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Some products are unavailable right now, You can not retry payment"})
		}

		let totalPrice=0;
		let totalAmount = 0;
		let anyOutOfStockProduct=false;
        let anyUnavailableProduct=false;


		//validate each item's quantity vs product stock
		for(const item of order.orderItems){
			if(item.productId.quantity === 0){
				return res.status(STATUS_CODES.NOT_FOUND).json({message:"Some product(s) are out of stock"})
			}

			if(item.quantity > item.productId.quantity){
				return res.status(STATUS_CODES.NOT_FOUND).json({message:"Some product(s) are few left."})
			}

            if(item.productId.isBlocked){
				return res.status(STATUS_CODES.NOT_FOUND).json({message:"Some product(s) are unavailable"})
            }

			totalPrice += (item.productId ? item.productId.salePrice : 0) * item.quantity;
			totalAmount += (item.productId ? item.productId.salePrice : 0) * item.quantity;
		}

		if(totalPrice===0){
			return res.status(STATUS_CODES.NOT_FOUND).json({message:"Product(s) unavailable."})
		}


		//if any coupon applied, re-calculate it
		if(order.appliedCoupons.length > 0){
			//checking coupons are valid, and available
			const appliedCouponIds=order.appliedCoupons.map((appliedCoupon)=>{
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
					return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Some coupons are expired or unavailable, You cannot retry this payment"})
				}

			//check if the product is valid category
			for(const coupon of coupons){
				if(coupon.isCategoryBased){
					const applicableCategoryIds = coupon.applicableCategories.map(applicableCatId => applicableCatId.toString());
					const hasApplicableProduct=order.orderItems.some((item)=>{
						return (item.productId?.category && applicableCategoryIds.includes(item.productId.category.toString()))
					})
					//if there is no applicable products
					if(!hasApplicableProduct){
						return res.status(STATUS_CODES.BAD_REQUEST).json({message:"These product categories don't have this coupon discount."})
					}
				}
			}

			//all set
			//calculate coupon discount

			const itemPriceDetails=[] //to store every product's total amount and total discount
			const appliedCouponsMap=new Map()


			for(const item of order.orderItems){
				const itemTotalMrp=item.productId.regularPrice * item.quantity;
				const itemTotalPrice=item.productId.salePrice * item.quantity;
				let itemTotalCouponDiscount=0;
				
				for(const coupon of coupons){
					if(coupon.isCategoryBased){
						//if the product is other category, skip this coupon application for that product
						if(
						!coupon.applicableCategories
							.some((catId)=>{return catId.toString()=== item.productId.category.toString()})
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


						if(!appliedCouponsMap.has(coupon.couponCode)){
							appliedCouponsMap.set(
								coupon.couponCode,
									{
										couponId:coupon._id,
										discountType:coupon.discountType,
										discountValue:coupon.discountValue,
										minPurchase:coupon.minPurchase,
										maxDiscountAmount:coupon.maxDiscountAmount,
										isCategoryBased:coupon.isCategoryBased,
										applicableCategories:coupon.applicableCategories,
										excludeCategories:coupon.excludedCategories
									}
							)
						}
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

						if(!appliedCouponsMap.has(coupon.couponCode)){
							appliedCouponsMap.set(
								coupon.couponCode,
									{

										couponId:coupon._id,
										discountType:coupon.discountType,
										discountValue:coupon.discountValue,
										minPurchase:coupon.minPurchase,
										maxDiscountAmount:coupon.maxDiscountAmount,
										isCategoryBased:coupon.isCategoryBased,
										applicableCategories:coupon.applicableCategories,
										excludeCategories:coupon.excludedCategories
									}
							)
						}
					}
				}

				itemPriceDetails.push({
					productId:item.productId._id.toString(),
					itemMrp:item.productId.regularPrice,
					itemTotalMrp:itemTotalMrp,
					itemPrice:item.productId.salePrice,
					itemTotalPrice:itemTotalPrice,
					itemTotalCouponDiscount:itemTotalCouponDiscount,
					itemTotalAmount:itemTotalPrice-itemTotalCouponDiscount
				})
			}

			//prepare order items obj with coupon discount
			const orderItems=order.orderItems.map((item)=>{
			return {
					productId:item.productId._id.toString(),
					categoryId:item.productId.category._id.toString(),
					productName:item.productId.productName,
					productImage:item.productId.productImage[0].url,
					quantity:item.quantity,
					// itemStatus:DELIVERY_STATUS.PENDING
				}
			})

			orderItems.forEach((o)=>{
				const itemPrices=itemPriceDetails.find((i)=>{ return i.productId === o.productId})
				o.mrp=itemPrices.itemMrp;
				o.totalMrp=itemPrices.itemTotalMrp;
				o.couponDiscount=itemPrices.itemTotalCouponDiscount;
				o.offerDiscount=itemPrices.itemTotalMrp-itemPrices.itemTotalPrice;
				o.salePrice=itemPrices.itemPrice
				o.totalSalePrice=itemPrices.itemTotalPrice;
				o.price=itemPrices.itemTotalAmount;
				o.finalPaidAmount=itemPrices.itemTotalAmount;
				o.finalCouponDiscount=itemPrices.itemTotalCouponDiscount
			})

			const totalMrp=itemPriceDetails.reduce((sum,curr)=>{
				return sum+curr.itemTotalMrp
			},0)

			const totalCouponDiscount=itemPriceDetails.reduce((sum,curr)=>{
				return sum+curr.itemTotalCouponDiscount
			},0)

			const totalAmount=itemPriceDetails.reduce((sum,curr)=>{
			return sum+curr.itemTotalAmount
			},0)

			const totalOfferDiscount=totalMrp-totalPrice;

			// 5. Create order
			order.orderId=orderId;
			order.userId=userId;
			order.paymentMethod="Online Payment";
			// order.paymentStatus="Pending";
			// order.orderStatus=DELIVERY_STATUS.PENDING;
			order.orderItems=orderItems;
			order.totalMrp=totalMrp;
			order.totalCouponDiscount=totalCouponDiscount;
			order.finalTotalCouponDiscount=totalCouponDiscount;
			order.appliedCoupons=[...appliedCouponsMap.values()]
			order.isCouponApplied=[...appliedCouponsMap.values()].length > 0 ? true : false;
			order.totalOfferDiscount=totalOfferDiscount;
			order.finalTotalOfferDiscount=totalOfferDiscount;
			order.totalPrice=totalPrice;
			order.finalTotalPrice=totalPrice;
			order.totalAmount=totalAmount;
			order.finalTotalAmount=totalAmount

			await order.save();

			const options={
				amount:Math.round(totalAmount) * 100,
				currency:"INR",
				receipt:orderId
			}

			const razorpayOrder =await razorpay.orders.create(options);
			return res.json({razorpayOrder,teeSpaceOrderId:orderId});
		}

		//if there is no applied coupon
		if(order.appliedCoupons.length === 0){

			const orderItems = order.orderItems.map(item => ({
					productId: item.productId._id,
					categoryId:item.productId.category._id.toString(),
					productName: item.productId.productName,
					productImage: item.productId.productImage[0].url,
					quantity: item.quantity,
					mrp:item.productId.regularPrice,
					totalMrp:item.productId.regularPrice * item.quantity,
					salePrice:item.productId.salePrice,
					totalSalePrice:item.productId.salePrice * item.quantity,
					price: item.productId.salePrice*item.quantity,
					finalPaidAmount:item.productId.salePrice*item.quantity,
					offerDiscount:(item.productId.regularPrice * item.quantity)-(item.productId.salePrice * item.quantity),
					// itemStatus: DELIVERY_STATUS.PENDING // 👈 every product starts as "Pending"
			}));

			const totalMrp=order.orderItems.reduce((sum,item)=>{
				return sum+item.productId.regularPrice*item.quantity
			},0)

			const totalOfferDiscount=totalMrp-totalPrice;

			order.orderItems=orderItems;
			order.orderId=orderId;
			order.userId=userId;
			order.paymentMethod="Online Payment";
			// order.paymentStatus="Pending";
			// order.orderStatus=DELIVERY_STATUS.PENDING;
			order.totalMrp=totalMrp;
			order.totalOfferDiscount=totalOfferDiscount;
			order.finalTotalOfferDiscount=totalOfferDiscount;
			order.totalPrice=totalPrice;
			order.finalTotalPrice=totalPrice;
			order.totalAmount=totalAmount;
			order.finalTotalAmount=totalAmount;

			await order.save();

		

			const options={
				amount:Math.round(totalAmount) * 100,
				currency:"INR",
				receipt:orderId
			}

			const razorpayOrder =await razorpay.orders.create(options);
			return res.json({razorpayOrder,teeSpaceOrderId:orderId});
		}

	} catch (error) {
		console.error("retryPaymentFromOrderDetailsPage() error == ",error)
	}
}











const verifyRazorpayPayment = async (req,res)=>{
	try {
		const { razorpay_order_id, razorpay_payment_id, razorpay_signature ,teeSpaceOrderId, clearCart=true} =req.body;
    const userId=req.session.user || req.session.passport?.user

    const order=await Order.findOne({userId,orderId:teeSpaceOrderId})
		.populate({
			path:"orderItems.productId"
		})
    if(!order) return res.status(STATUS_CODES.BAD_REQUEST).json({success:false,message:"Order not found, Please try again"})
    

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
      
      return res.status(STATUS_CODES.BAD_REQUEST).json({ success: false, message: "Payment verification failed." });
    }


    //reduce stock
    const session = await mongoose.startSession();

    try {
        session.startTransaction();
        for(let item of order.orderItems){
            const productId=item.productId._id;
            const quantityToReduce=item.quantity;

            const result = await Product.updateOne(
                {
                    _id:productId,
                    quantity:{$gte:quantityToReduce}
                },
                {
                    $inc:{quantity:-quantityToReduce}
                },
                {session}
            );

            if(result.modifiedCount === 0){
                throw new Error(`Not enough stocks for ${item.productId.productName}`);
            }
        }

        await session.commitTransaction();

    } catch (error) {
        await session.abortTransaction();
        console.log("verifyRazorpayPayment == mongo DB transaction error == ",error)
        return res.status(STATUS_CODES.BAD_REQUEST).json({ message: error.message });
    } finally {
        session.endSession();
    }


    // Mark order as paid
    order.paymentStatus = "Paid";
    order.orderStatus = DELIVERY_STATUS.PENDING;
    await order.save();

    
    //check if any referral coupons
    //if yes, it should be removed, referral coupons are one time usable
    console.log("order.appliedCoupons ============ ",order.appliedCoupons)

    const allReferralCoupons=await Coupon.find({userId})
    console.log("all referral coupons === ",allReferralCoupons)
    const appliedRefCoupons=allReferralCoupons.filter((allC)=>{
      return order.appliedCoupons.some((oc)=>{
        return allC._id.toString()===oc.couponId.toString()
      })
    })

    const appliedRefCouponIds=appliedRefCoupons.map((c)=>{return c._id.toString()})

    await Coupon.deleteMany({userId,_id:{$in:appliedRefCouponIds}})
    

    //  Clear cart
    if(clearCart){
        await Cart.updateOne({userId}, { $set: { items: [] ,appliedCoupons:[]} });
    }

    return res.json({ success: true, message: "Payment verified successfully." ,orderId:teeSpaceOrderId});
	} catch (error) {
		console.log("verifyRazorpayPayment() error===>",error)
        return res.status(STATUS_CODES.INTERNAL_ERROR).json({
            success: false,
            message: "Something went wrong while verifying payment.",
            messageForUser:error.message
        });
	}
}









const place_cod_order=async (req,res)=>{
    try {
        const userId=req.session.user || req.session.passport?.user;
        const {addressId,appliedCoupons=[]}=req.body;
        
        if(!userId)return res.status(STATUS_CODES.BAD_REQUEST).json({message:"session expired"})

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
    
        if(!userCart || userCart.items.length===0) return res.status(STATUS_CODES.BAD_REQUEST).json({status:false,message:"Cart is empty",reload:true})

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
            return res.status(STATUS_CODES.BAD_REQUEST).json({message:"some products are invalid,please try again",reload:true})
        }
        
        let totalPrice=0;
        let totalAmount = 0;
        let isCartUpdated = false;//initially set as false.
        let anyOutOfStockProduct=false;
        let anyZeroCountProduct=false;
        let anyUnavailableProduct=false




        // Check each item quantity vs stock
        for (const item of userCart.items) {
          //checking if any product is out of stock
            if(item.productId.quantity===0){
              anyOutOfStockProduct=true;
            }
            //checking if any products buying count is zero
            if(item.quantity===0){
                anyZeroCountProduct=true;
            }
            if(item.productId.isBlocked){
                anyUnavailableProduct=true;
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
          return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Some products are few left or out of stock, Please re-check your cart",reload:true})
        }

        if(totalPrice===0){
          return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Your cart is empty,re-check your cart and please try again",reload:true})
        }

        if(anyOutOfStockProduct){
          return res.status(STATUS_CODES.BAD_REQUEST).json({message:"There is 'out of stock' products, Please remove the 'out of stock' product(s)",reload:true})
        }

        if(anyZeroCountProduct){
          return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Product(s) with zero buying count in your cart, Please increase the buying count"})
        }

        if(anyUnavailableProduct){
            return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Unavailable product(s) in your cart",reload:true})
        }

        if(userCart.appliedCoupons.length === 0 && totalAmount>1000){
          return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Cash on Delivery is not available for order above Rs.1000/-",reload:true})
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
                  return res.status(STATUS_CODES.INTERNAL_ERROR).json({message:"Coupon mismatch, please try again",reload:true})
                }
            }else{
              userCart.appliedCoupons=[];
              await userCart.save()
              return res.status(STATUS_CODES.INTERNAL_ERROR).json({message:"Coupon mismatch, please try again",reload:true})
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
              return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Some coupons are expired or unavailable, Please try again",reload:true})
            }

            //re-checking if cart total meeting minPurchase for coupon discount.every coupon has atleast 0 minPurchase
            const areCouponsMeetMinPurchase=coupons.every((coupon)=>{
              return coupon.minPurchase <= totalPrice
            })
            if(!areCouponsMeetMinPurchase){
              userCart.appliedCoupons=[];
              userCart.save()
              return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Minimum Purchase required for the coupon, Please try again",reload:true})
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
                      return res.status(STATUS_CODES.BAD_REQUEST).json({message:"These product categories don't have this coupon discount, Please try again",reload:true})
                    }
                }
            }

            //calculate coupon discount
            const itemPriceDetails=[] //to store every products total amount and total discount
            const appliedCouponsMap=new Map()


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

                    if(!appliedCouponsMap.has(coupon.couponCode)){
                          appliedCouponsMap.set(
                              coupon.couponCode,
                              {
                                discountType:coupon.discountType,
                                discountValue:coupon.discountValue,
                                minPurchase:coupon.minPurchase,
                                maxDiscountAmount:coupon.maxDiscountAmount,
                                isCategoryBased:coupon.isCategoryBased,
                                applicableCategories:coupon.applicableCategories,
                                excludeCategories:coupon.excludedCategories
                              }
                        )
                    }

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


                    if(!appliedCouponsMap.has(coupon.couponCode)){
                          appliedCouponsMap.set(
                              coupon.couponCode,
                              {
                                discountType:coupon.discountType,
                                discountValue:coupon.discountValue,
                                minPurchase:coupon.minPurchase,
                                maxDiscountAmount:coupon.maxDiscountAmount,
                                isCategoryBased:coupon.isCategoryBased,
                                applicableCategories:coupon.applicableCategories,
                                excludeCategories:coupon.excludedCategories
                              }
                        )
                    }
                }
              }
              itemPriceDetails.push({
                productId:item.productId._id.toString(),
				itemMrp:item.productId.regularPrice,
                itemTotalMrp:itemTotalMrp,
				itemPrice:item.productId.salePrice,
                itemTotalPrice:itemTotalPrice,
                itemTotalCouponDiscount:itemTotalCouponDiscount,
                itemTotalAmount:itemTotalPrice-itemTotalCouponDiscount
              })
            }


            //appliedCoupons=req.body.appliedCoupons , which contians coupon codes and coupon IDs.
            //from now on, appliedCoupons[] will be filled with :applied coupon discount, discount type, discountValue, minimumPurchase amount
            // for managing the refund calculation when user cancelling the order, and returning the order in the future
            appliedCoupons.length=0;

            for(const [key,value] of appliedCouponsMap){
              appliedCoupons.push(value)
            }

            //prepare order items obj with coupon discount
            const orderItems=userCart.items.map((item)=>{
              return {
                productId:item.productId._id.toString(),
                categoryId:item.productId.category._id.toString(),
                productName:item.productId.productName,
                productImage:item.productId.productImage[0].url,
                quantity:item.quantity,
                itemStatus:"Pending"
              }
            })

            // console.log("orderItems BEFORE===========>",orderItems)

            orderItems.forEach((o)=>{
              const itemPrices=itemPriceDetails.find((i)=>{ return i.productId === o.productId})
              o.mrp=itemPrices.itemMrp;
			  o.totalMrp=itemPrices.itemTotalMrp;
              o.couponDiscount=itemPrices.itemTotalCouponDiscount;
              o.offerDiscount=itemPrices.itemTotalMrp-itemPrices.itemTotalPrice;
			  o.salePrice=itemPrices.itemPrice
			  o.totalSalePrice=itemPrices.itemTotalPrice
              o.price=itemPrices.itemTotalAmount;
			  o.finalPaidAmount=itemPrices.itemTotalAmount;
			  o.finalCouponDiscount=itemPrices.itemTotalCouponDiscount;
            })

            // const totalPrice=itemPriceDetails.reduce((sum,curr)=>{
            //   return sum+curr.itemTotalPrice
            // },0)

            const totalAmount=itemPriceDetails.reduce((sum,curr)=>{
              return sum+curr.itemTotalAmount
            },0)

            console.log("totalAmount after coupon application============",totalAmount)

            if(totalAmount>1000){
                return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Cash on Delivery is not available for orders above Rs.1000/-",reload:true})
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
				finalTotalOfferDiscount:totalOfferDiscount,
                totalCouponDiscount,
				finalTotalCouponDiscount:totalCouponDiscount,
                appliedCoupons,
				isCouponApplied:appliedCoupons.length>0?true:false,
                totalPrice,
				finalTotalPrice:totalPrice,
                totalAmount,
				finalTotalAmount:totalAmount
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
          categoryId:item.productId.category._id.toString(),
          productName: item.productId.productName,
          productImage: item.productId.productImage[0].url,
          quantity: item.quantity,
          mrp:item.productId.regularPrice,
		  totalMrp:item.productId.regularPrice * item.quantity,
		  salePrice:item.productId.salePrice,
		  totalSalePrice:item.productId.salePrice*item.quantity,
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
			finalTotalPrice:totalPrice,
            totalOfferDiscount,
			finalTotalOfferDiscount:totalOfferDiscount,
            totalAmount,
			finalTotalAmount:totalAmount
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

        return res.status(STATUS_CODES.INTERNAL_ERROR).json({
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
      if(!userWallet)return res.status(STATUS_CODES.INTERNAL_ERROR).json({success:false,message:"Your wallet is not found"})

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

      if(!userCart || userCart.items.length===0) return res.status(STATUS_CODES.BAD_REQUEST).json({status:false,message:"Cart is empty",reload:true})

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
          return res.status(STATUS_CODES.BAD_REQUEST).json({message:"some products are invalid,please try again",reload:true})
      }

      let totalPrice=0;
      let totalAmount = 0;
      let isCartUpdated = false;//initially set as false.
      let anyOutOfStockProduct=false;
      let anyZeroCountProduct=false;
      let anyUnavailableProduct=false;




      // Check each item quantity vs stock
      for (const item of userCart.items) {
        //checking if any product is out of stock
          if(item.productId.quantity===0){
            anyOutOfStockProduct=true;
          }

          //checking if any product buying count is zero
           if(item.quantity===0){
            anyZeroCountProduct=true;
          }

            if(item.productId.isBlocked){
                anyUnavailableProduct=true;
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
        return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Some products are few left or out of stock, Please re-check your cart",reload:true})
      }

      if(totalPrice===0){
        return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Your cart is empty,re-check your cart and please try again",reload:true})
      }

      if(anyOutOfStockProduct){
        return res.status(STATUS_CODES.BAD_REQUEST).json({message:"There is 'out of stock' products, Please remove 'out of stock' product(s)",reload:true})
      }

      if(anyZeroCountProduct){
        return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Product(s) with zero buying count in your cart, Please increase the buying count"})
      }

       if(anyUnavailableProduct){
        return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Unavailable product(s) in your cart",reload:true})
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
                  return res.status(STATUS_CODES.INTERNAL_ERROR).json({message:"Coupon mismatch, please try again",reload:true})
                }
            }else{
              userCart.appliedCoupons=[];
              await userCart.save()
              return res.status(STATUS_CODES.INTERNAL_ERROR).json({message:"Coupon mismatch, please try again",reload:true})
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
              return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Some coupons are expired or unavailable, Please try again",reload:true})
            }

            //re-checking if cart total meeting minPurchase for coupon discount.every coupon has atleast 0 minPurchase
            const areCouponsMeetMinPurchase=coupons.every((coupon)=>{
              return coupon.minPurchase <= totalPrice
            })
            if(!areCouponsMeetMinPurchase){
              userCart.appliedCoupons=[];
              userCart.save()
              return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Minimum Purchase required for the coupon, Please try again",reload:true})
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
                return res.status(STATUS_CODES.BAD_REQUEST).json({message:"These product categories don't have this coupon discount, Please try again",reload:true})
              }
              }
            }

            //calculate coupon discount
            const itemPriceDetails=[] //to store every products total amount and total discount
            const appliedCouponsMap=new Map()


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


                    if(!appliedCouponsMap.has(coupon.couponCode)){
                          appliedCouponsMap.set(
                              coupon.couponCode,
                              {
                                discountType:coupon.discountType,
                                discountValue:coupon.discountValue,
                                minPurchase:coupon.minPurchase,
                                maxDiscountAmount:coupon.maxDiscountAmount,
                                isCategoryBased:coupon.isCategoryBased,
                                applicableCategories:coupon.applicableCategories,
                                excludeCategories:coupon.excludedCategories
                              }
                        )
                    }
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

                    if(!appliedCouponsMap.has(coupon.couponCode)){
                          appliedCouponsMap.set(
                              coupon.couponCode,
                              {
                                discountType:coupon.discountType,
                                discountValue:coupon.discountValue,
                                minPurchase:coupon.minPurchase,
                                maxDiscountAmount:coupon.maxDiscountAmount,
                                isCategoryBased:coupon.isCategoryBased,
                                applicableCategories:coupon.applicableCategories,
                                excludeCategories:coupon.excludedCategories
                              }
                        )
                    }
                }
              }
              itemPriceDetails.push({
                productId:item.productId._id.toString(),
				itemMrp:item.productId.regularPrice,
                itemTotalMrp:itemTotalMrp,
				itemPrice:item.productId.salePrice,
                itemTotalPrice:itemTotalPrice,
                itemTotalCouponDiscount:itemTotalCouponDiscount,
                itemTotalAmount:itemTotalPrice-itemTotalCouponDiscount
              })
            }


            //appliedCoupons=req.body.appliedCoupons , which contians coupon codes and coupon IDs.
            //from now on, appliedCoupons[] will be filled with :applied coupon discount, discount type, discountValue, minimumPurchase amount
            // for managing the refund calculation when user cancelling the order, and returning the order in the future
            appliedCoupons.length=0;

            for(const [key,value] of appliedCouponsMap){
              appliedCoupons.push(value)
            }

            //prepare order items obj with coupon discount
            const orderItems=userCart.items.map((item)=>{
              return {
                productId:item.productId._id.toString(),
                categoryId:item.productId.category._id.toString(),
                productName:item.productId.productName,
                productImage:item.productId.productImage[0].url,
                quantity:item.quantity,
                itemStatus:"Pending"
              }
            })

            // console.log("orderItems BEFORE===========>",orderItems)

            orderItems.forEach((o)=>{
              const itemPrices=itemPriceDetails.find((i)=>{ return i.productId === o.productId})
              o.mrp=itemPrices.itemMrp;
			  o.totalMrp=itemPrices.itemTotalMrp;
              o.couponDiscount=itemPrices.itemTotalCouponDiscount;
              o.offerDiscount=itemPrices.itemTotalMrp-itemPrices.itemTotalPrice;
			  o.salePrice=itemPrices.itemPrice;
			  o.totalSalePrice=itemPrices.itemTotalPrice;
              o.price=itemPrices.itemTotalAmount;
			  o.finalPaidAmount=itemPrices.itemTotalAmount;
			  o.finalCouponDiscount=itemPrices.itemTotalCouponDiscount
            })

            const totalAmount=itemPriceDetails.reduce((sum,curr)=>{
              return sum+curr.itemTotalAmount
            },0)

            if(totalAmount>userWallet.balance){
              return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Not enough balance in your wallet",reload:true})
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
				finalTotalOfferDiscount:totalOfferDiscount,
                totalCouponDiscount,
				finalTotalCouponDiscount:totalCouponDiscount,
                appliedCoupons,
				isCouponApplied:appliedCoupons.length>0?true:false,
                totalPrice,
				finalTotalPrice:totalPrice,
                totalAmount,
				finalTotalAmount:totalAmount
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
          return res.status(STATUS_CODES.BAD_REQUEST).json({message:"Not enough balance in your wallet",reload:true})
      }

      // Prepare order items with itemStatus
        const orderItems = userCart.items.map(item => ({
          productId: item.productId._id,
          categoryId:item.productId.category._id.toString(),
          productName: item.productId.productName,
          productImage: item.productId.productImage[0].url,
          quantity: item.quantity,
		  mrp:item.productId.regularPrice,
          totalMrp:item.productId.regularPrice * item.quantity,
		  salePrice:item.productId.salePrice,
          totalSalePrice: item.productId.salePrice*item.quantity,
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
		  finalTotalPrice:totalPrice,
          totalOfferDiscount,
		  finalTotalOfferDiscount:totalOfferDiscount,
          totalAmount,
		  finalTotalAmount:totalAmount
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
      return res.status(STATUS_CODES.INTERNAL_ERROR).json({
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
			razorPayKeyId:process.env.RAZORPAY_KEY_ID,
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






// // Cancel a single product in an order
// const cancelOrderItem = async (req, res) => {
//     try {
//         const userId = req.session.user || req.session.passport?.user;
//         if (!userId) {
//         return res.status(401).json({ success: false, message: "Login required" });
//         }

//         const { orderId, itemId, reason } = req.body;

//         const order = await Order.findOne({ orderId, userId });
//         if (!order) {
//         return res.status(404).json({ success: false, message: "Order not found" });
//         }

//         const cancellingItem = order.orderItems.id(itemId); // find subdocument
//         if (!cancellingItem) {
//         return res.status(404).json({ success: false, message: "Item not found" });
//         }

//         if (cancellingItem.itemStatus !== "Pending") {
//         return res.status(STATUS_CODES.BAD_REQUEST).json({ success: false, message: "Item cannot be cancelled at this stage" });
//         }



//         //  Restore stock
//         await restoreStock([cancellingItem],reason);

//         //  Update item refund status (only if paid & online)
//         // if (order.paymentMethod === "Online Payment" && order.paymentStatus === "Paid") {
//         //   item.refundStatus = "Refunded";
//         //   item.refundedOn=new Date();
//         // }

//         //  Update item refund status (only if paid & online or wallet)
//         if(order.paymentMethod === "TeeSpace Wallet" && order.paymentStatus === "Paid" || order.paymentMethod === "Online Payment" && order.paymentStatus === "Paid"){

//             //if coupon applied, recalculate the coupon discounts for other products
//             if(order.appliedCoupons.length > 0){  
                
//                 //calculating the old total price
//                 const oldOrderTotalPrice=order.orderItems.reduce((itemPrice,item)=>{
//                     return itemPrice+item.price;
//                 },0) 

//                 const oldOrderTotalPrice=order.orderItems
//                     .filter((item)=>{
//                         return item.refundStatus!=="Refunded to your wallet"
//                     })
//                     .reduce((itemPrice,item)=>{
//                         return itemPrice+item.price;
//                     },0)


//                 //caluculating the current order total price excluding the cancelling the order.
//                 const currentOrderTotalPrice = order.orderItems
//                         .filter((item)=>{
//                             return item._id.toString() !== cancellingItem._id.toString()
//                         })
//                         .reduce((total,item)=>{
//                             return total+item.price+item.couponDiscount
//                         },0)

//                 //now checking new order total price is meeting mininmum purchase amount for coupon discount
//                 const applicableCoupons=order.appliedCoupons.filter((appliedCoupon)=>{
//                     return appliedCoupon.minPurchase <= currentOrderTotalPrice
//                 })

//                 //checking if there is applicable coupons after decreasing the price of the cancelling order
//                 if(applicableCoupons.length>0){
//                     //calculate the discount for current products
//                     for(const item of order.orderItems){
//                         //prevent coupon calculation for cancelling item.
//                         if(item._id.toString() === cancellingItem._id.toString()){
//                             // item.price=item.price+item.couponDiscount;
//                             // item.couponDiscount=0;
//                             await order.save();
//                             continue;
//                         }

//                         const itemTotalPrice=item.price+item.couponDiscount;
//                         let itemTotalCouponDiscount=0
//                         for(const coupon of applicableCoupons){
//                             if(coupon.isCategoryBased){
//                                 //if the product is other category, skip this coupon application for that product
//                                 if(
//                                     !coupon.applicableCategories
//                                     .some((catId)=>{return catId.toString()=== item.categoryId.toString()})
//                                     ){
//                                         continue;
//                                 }

//                                 let discount=0;
//                                 if(coupon.discountType === "percentage"){
//                                     discount=(itemTotalPrice * coupon.discountValue)/100;
//                                 }

//                                 if(coupon.discountType === "fixed"){
//                                     discount=(itemTotalPrice / currentOrderTotalPrice)/coupon.discountValue;
//                                 }

//                                 //cap max discount
//                                 if(coupon.maxDiscountAmount && discount > coupon.maxDiscountAmount){
//                                     discount=coupon.maxDiscountAmount;
//                                 }

//                                 itemTotalCouponDiscount+=discount;
//                             }

//                             if(!coupon.isCategoryBased){
//                                 let discount=0;

//                                 if(coupon.discountType === "percentage"){
//                                     discount=(itemTotalPrice * coupon.discountValue)/100;
//                                 }

//                                 if(coupon.discountType === "fixed"){
//                                     discount=(itemTotalPrice / currentOrderTotalPrice)/coupon.discountValue
//                                 }

//                                 //cap max discount
//                                 if(coupon.maxDiscountAmount && discount > coupon.maxDiscountAmount){
//                                     discount=coupon.maxDiscountAmount;
//                                 }

//                                 itemTotalCouponDiscount+=discount;

//                             }
//                         }

//                         //updating item level new coupon discount & price
//                         item.couponDiscount=itemTotalCouponDiscount;
//                         item.price=itemTotalPrice - itemTotalCouponDiscount;

//                         await order.save()
//                     }


                    

//                     //caluculating the new total price
//                     const newOrderTotalPrice=order.orderItems
//                         .filter((item)=>{
//                             return item._id.toString() !== cancellingItem._id.toString()
//                         })
//                         .reduce((totalPrice,item)=>{
//                             return totalPrice + item.price
//                         },0)


//                     //keeping current total, and refunding the rest
//                     const refundAmount=oldOrderTotalPrice-newOrderTotalPrice;

//                     let userWallet=await Wallet.findOne({userId})
//                     if(!userWallet){
//                         userWallet = new Wallet({ userId: order.userId, balance: 0, transactions: [] });
//                     }

//                     userWallet.balance+=refundAmount;
//                     userWallet.transactions.push({
//                         amount:refundAmount,
//                         type:"credit",
//                         description:`Refund for ${cancellingItem.productName} (Order ${order.orderId})`
//                     })
//                     await userWallet.save();
//                     cancellingItem.refundStatus = "Refunded to your wallet";
//                     cancellingItem.refundedOn = new Date();
//                 }

//                 if(applicableCoupons.length===0){
//                     //which means no product will have coupon discount
//                     //every product will be bought on saleprice
//                     //update order prices and coupon discounts
//                     for(const item of order.orderItems){
//                         item.price=item.price+item.couponDiscount
//                         item.couponDiscount=0;
//                         await order.save();
//                     }

//                     //caluculating the new total price
//                     const newOrderTotalPrice=order.orderItems
//                         .filter((item)=>{
//                             return item._id.toString() !== cancellingItem._id.toString()
//                         })
//                         .reduce((totalPrice,item)=>{
//                             return totalPrice + item.price
//                         },0)

//                     //keeping current total, and refunding the rest
//                     const refundAmount=oldOrderTotalPrice-newOrderTotalPrice;

//                     let userWallet=await Wallet.findOne({userId})
//                     if(!userWallet){
//                         userWallet = new Wallet({ userId: order.userId, balance: 0, transactions: [] });
//                     }

//                     userWallet.balance+=refundAmount;
//                     userWallet.transactions.push({
//                         amount:refundAmount,
//                         type:"credit",
//                         description:`Refund for ${cancellingItem.productName} (Order ${order.orderId})`
//                     })
//                     await userWallet.save();
//                     cancellingItem.refundStatus = "Refunded to your wallet";
//                     cancellingItem.refundedOn = new Date();
//                 }



//             }

//             if(order.appliedCoupons.length === 0){
//                 //refund the paid amount
//                 let userWallet=await Wallet.findOne({userId})
//                 if(!userWallet){
//                     userWallet = new Wallet({ userId: order.userId, balance: 0, transactions: [] });
//                 }

//                 userWallet.balance+=cancellingItem.price;
//                 userWallet.transactions.push({
//                     amount:cancellingItem.price,
//                     type:"credit",
//                     description:`Refund for ${cancellingItem.productName} (Order ${order.orderId})`
//                 })
//                 await userWallet.save();
//                 cancellingItem.refundStatus = "Refunded to your wallet";
//                 cancellingItem.refundedOn = new Date();
//             }
//         }

//         if(order.paymentMethod === "Cash on Delivery"){
//             if(order.appliedCoupons.length > 0){
//                 //calculating the old total price
//                 const oldOrderTotalPrice=order.orderItems.reduce((itemPrice,item)=>{
//                     return itemPrice+item.price;
//                 },0) 

//                 //caluculating the current order total price after the cancelling the order.
//                 const currentOrderTotalPrice = order.orderItems
//                         .filter((item)=>{
//                             return item._id.toString() !== cancellingItem._id.toString()
//                         })
//                         .reduce((total,item)=>{
//                             return total+item.price+item.couponDiscount
//                         },0)
                
//                 //now checking new order total price is meeting mininmum purchase amount for coupon discount
//                 const applicableCoupons=order.appliedCoupons.filter((appliedCoupon)=>{
//                     return appliedCoupon.minPurchase <= currentOrderTotalPrice
//                 })

//                 if(applicableCoupons.length > 0){
//                     //re-calculate coupon discount for the current products excluding the cancelling product
//                     for(const item of order.orderItems){
//                         //prevent coupon discount calculation for cancelling item.
//                         if(item._id.toString() === cancellingItem._id.toString()){
//                             item.price=item.price+item.couponDiscount;
//                             item.couponDiscount=0;
//                             await order.save();
//                             continue;
//                         }

//                         const itemTotalPrice=item.price+item.couponDiscount;
//                         let itemTotalCouponDiscount=0

//                         for(const coupon of applicableCoupons){
//                             if(coupon.isCategoryBased){
//                                 //if the product is other category, skip this coupon application for that product
//                                 if(
//                                     !coupon.applicableCategories
//                                     .some((catId)=>{return catId.toString()=== item.categoryId.toString()})
//                                     ){
//                                         continue;
//                                 }

//                                 let discount=0;
//                                 if(coupon.discountType === "percentage"){
//                                     discount=(itemTotalPrice * coupon.discountValue)/100;
//                                 }

//                                 if(coupon.discountType === "fixed"){
//                                     discount=(itemTotalPrice / currentOrderTotalPrice)/coupon.discountValue;
//                                 }

//                                 //cap max discount
//                                 if(coupon.maxDiscountAmount && discount > coupon.maxDiscountAmount){
//                                     discount=coupon.maxDiscountAmount;
//                                 }

//                                 itemTotalCouponDiscount+=discount;
//                             }

//                             if(!coupon.isCategoryBased){
//                                 let discount=0;

//                                 if(coupon.discountType === "percentage"){
//                                     discount=(itemTotalPrice * coupon.discountValue)/100;
//                                 }

//                                 if(coupon.discountType === "fixed"){
//                                     discount=(itemTotalPrice / currentOrderTotalPrice)/coupon.discountValue
//                                 }

//                                 //cap max discount
//                                 if(coupon.maxDiscountAmount && discount > coupon.maxDiscountAmount){
//                                     discount=coupon.maxDiscountAmount;
//                                 }

//                                 itemTotalCouponDiscount+=discount;

//                             }
//                         }

//                         //new coupon discount & price
//                         item.couponDiscount=itemTotalCouponDiscount;
//                         item.price=itemTotalPrice - itemTotalCouponDiscount;
//                         await order.save()

//                     } 
//                 }
                
//             }
//         }

//         //updating the order level prices
//         let totalMrp=0, totalOfferDiscount=0, totalCouponDiscount=0, totalPrice=0, totalAmount=0;
//         for(const item of order.orderItems){
//             totalMrp+=item.mrp;
//             totalOfferDiscount+=item.offerDiscount;
//             totalCouponDiscount+=item.couponDiscount;
//             totalPrice+=(item.mrp - item.offerDiscount);
//             totalAmount+=item.price;
//         }
//         order.totalMrp=totalMrp;
//         order.totalOfferDiscount=totalOfferDiscount;
//         order.totalCouponDiscount=totalCouponDiscount;
//         order.totalPrice=totalPrice;
//         order.totalAmount=totalAmount;

//         await order.save();


//         const allStatuses = order.orderItems.map(i => i.itemStatus);
//         const allStatusSet=new Set(allStatuses)

//         if(allStatusSet.size===1 && allStatusSet.has("Cancelled")){
//         order.orderStatus = "Cancelled"
//         }
//         if(allStatusSet.size===1 && allStatusSet.has("Delivered")){
//         order.orderStatus = "Delivered";
//         order.deliveredOn=new Date();
//         }
//         if(allStatusSet.size===2 && allStatusSet.has('Delivered') && allStatusSet.has("Cancelled")){
//         order.orderStatus="Delivered";

//         const deliveredDates=order.orderItems
//             .map((item)=>item.deliveredOn)
//             .filter((date)=>date)
//         deliveredDates.sort((a,b)=>a-b);
//         const latestDeliveredDate=deliveredDates[deliveredDates.length-1];

//         order.deliveredOn=latestDeliveredDate;
//         }


//         // //  Update order status
//         // const allCancelled = order.orderItems.every(i => i.itemStatus === "Cancelled");
//         // const someCancelled = order.orderItems.some(i => i.itemStatus === "Cancelled");

//         // if (allCancelled) {
//         //   order.orderStatus = "Cancelled";
//         // } else if (someCancelled) {
//         //   order.orderStatus = "Partially Cancelled";
//         // }

//         //  Update order refund summary
//         const allRefunded = order.orderItems.every(i => i.refundStatus === "Refunded to your wallet");
//         const someRefunded = order.orderItems.some(i => i.refundStatus === "Refunded to your wallet");

//         if (allRefunded) {
//         order.refundStatus = "Refunded";
//         } else if (someRefunded) {
//         order.refundStatus = "Partially Refunded";
//         }

//         // const refundAmount = cancellingItem.price;
//         // const offerDiscount=cancellingItem.offerDiscount;
//         // const couponDiscount=cancellingItem.couponDiscount;

//         // order.totalMrp-=cancellingItem.mrp;
//         // order.totalPrice-=(refundAmount+offerDiscount);
//         // order.totalAmount-=refundAmount;
//         // order.totalOfferDiscount-=offerDiscount;
//         // order.totalCouponDiscount-=couponDiscount;


//         await order.save();

//         res.json({ success: true, message: "Item cancelled successfully" });

//     } catch (error) {
//         console.log("cancelOrderItem() error =>", error);
//         res.status(STATUS_CODES.INTERNAL_ERROR).json({ success: false, message: "Something went wrong" });
//     }
// };


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

        const cancellingItem = order.orderItems.id(itemId); // find subdocument
        if (!cancellingItem) {
        return res.status(404).json({ success: false, message: "Item not found" });
        }

        if (cancellingItem.itemStatus !== "Pending") {
        return res.status(STATUS_CODES.BAD_REQUEST).json({ success: false, message: "Item cannot be cancelled at this stage" });
        }



        //  Restore stock
        await restoreStock([cancellingItem],reason);

        //  Update item refund status (only if paid & online)
        // if (order.paymentMethod === "Online Payment" && order.paymentStatus === "Paid") {
        //   item.refundStatus = "Refunded";
        //   item.refundedOn=new Date();
        // }

        //  Update item refund status (only if paid & online or wallet)
        if(order.paymentMethod === "TeeSpace Wallet" && order.paymentStatus === "Paid" || order.paymentMethod === "Online Payment" && order.paymentStatus === "Paid"){

            //if coupon applied, recalculate the coupon discounts for other products
            if(order.appliedCoupons.length > 0){  
                
                const oldOrderTotalPrice=order.totalAmount


                //caluculating the existing items' total price before coupon discount
                //excluding the cancelling the order & already refunded items
                const currentOrderTotalPrice = order.orderItems
                        .filter((item)=>{
                            return item.refundStatus !== "Refunded to your wallet" && item._id.toString() !== cancellingItem._id.toString()
                        }).reduce((total,item)=>{
                            return total + item.price + item.couponDiscount
                        },0)

                //now checking new order total price is meeting mininmum purchase amount for coupon discount
                const applicableCoupons=order.appliedCoupons.filter((appliedCoupon)=>{
                    return appliedCoupon.minPurchase <= currentOrderTotalPrice
                })

                //checking if there is applicable coupons after decreasing the price of the cancelling order
                if(applicableCoupons.length>0){
                    let finalTotalOfferDiscount=0;
					let finaltotalCouponDiscount=0 
					let finalTotalPrice=0; 
					let finalTotalAmount=0;
                    //calculate the discount for current products
                    for(const item of order.orderItems){
                        //prevent coupon calculation for cancelling item.
                        //also for already refunded item.
                        if(item._id.toString() === cancellingItem._id.toString() || item.refundStatus === "Refunded to your wallet"){
                            continue;
                        }

                        const itemTotalPrice=item.price+item.couponDiscount;
                        let itemTotalCouponDiscount=0
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

                                itemTotalCouponDiscount+=discount;
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
						//storing updated price & coupon discount of the item
						item.finalPaidAmount = itemTotalPrice - itemTotalCouponDiscount
						item.finalCouponDiscount = itemTotalCouponDiscount;


						finalTotalOfferDiscount+=item.offerDiscount;
						finalTotalPrice+=item.totalSalePrice;
                        finaltotalCouponDiscount+=itemTotalCouponDiscount;
						finalTotalAmount+=(item.totalSalePrice - itemTotalCouponDiscount)
						
                    }
					//storing updated price details of the entire order
					order.finalTotalOfferDiscount=finalTotalOfferDiscount
					order.finalTotalCouponDiscount = finaltotalCouponDiscount;
					order.finalTotalPrice=finalTotalPrice;
					order.finalTotalAmount=finalTotalAmount;
					await order.save()

                    //after re-calculating the new coupon discount for existing items
                    //calculating the new total price for the existing items.
                    //now we need this amount, rest will be refunded
                    const newOrderTotalPrice=currentOrderTotalPrice - finaltotalCouponDiscount;
                   
                    //now, we need the amount for existing items, we keep it,
                    //also, we decreasing the already refunded amount,
                    //and refunding the rest
                    const refundAmount=order.totalAmount-(newOrderTotalPrice + order.refundedAmount);
                    

                    let userWallet=await Wallet.findOne({userId})
                    if(!userWallet){
                        userWallet = new Wallet({ userId: order.userId, balance: 0, transactions: [] });
                    }

                    userWallet.balance+=refundAmount;
                    userWallet.transactions.push({
                        amount:refundAmount,
                        type:"credit",
                        description:`Refund for ${cancellingItem.productName} (Order ${order.orderId})`
                    })
                    await userWallet.save();
                    cancellingItem.refundStatus = "Refunded to your wallet";
                    cancellingItem.refundedOn = new Date();

                    //updating total refunded amount in DB
                    order.refundedAmount += refundAmount;
                    await order.save();

                }

                if(applicableCoupons.length===0){
                    //which means no product will have coupon discount
                    //every product will be bought on saleprice
                    const currentOrderTotalPrice = order.orderItems
                        .filter((item)=>{
                            return item.refundStatus !== "Refunded to your wallet" && item._id.toString() !== cancellingItem._id.toString()
                        }).reduce((total,item)=>{
                            return total + item.price + item.couponDiscount
                        },0)
                    

                    //keeping current total, and refunding the rest
                    const refundAmount=order.totalAmount - (currentOrderTotalPrice  + order.refundedAmount);

                    let userWallet=await Wallet.findOne({userId})
                    if(!userWallet){
                        userWallet = new Wallet({ userId: order.userId, balance: 0, transactions: [] });
                    }

                    userWallet.balance+=refundAmount;
                    userWallet.transactions.push({
                        amount:refundAmount,
                        type:"credit",
                        description:`Refund for ${cancellingItem.productName} (Order ${order.orderId})`
                    })
                    await userWallet.save();
                    cancellingItem.refundStatus = "Refunded to your wallet";
                    cancellingItem.refundedOn = new Date();

                    order.refundedAmount += refundAmount
					
					//removing all coupon discount, because this order has no applicable coupon now.
					//not eligible for coupon
					for(const item of order.orderItems){
						item.finalPaidAmount=item.salePrice;
						item.finalCouponDiscount = 0;
					}
					
					const finalTotalPrice=order.orderItems
						.filter((item)=>{
							return item._id.toString() !== cancellingItem._id.toString() && item.refundStatus !== "Refunded to your wallet"
						})
						.reduce((totalPrice,item)=>{
							return totalPrice + item.totalSalePrice
						},0)

					

					order.finalTotalCouponDiscount=0;
					order.finalTotalPrice=finalTotalPrice;
					order.finalTotalAmount=finalTotalPrice;

					const finalTotalOfferDiscount=order.orderItems
						.filter((item)=>{
							return item.refundStatus !== "Refunded to your wallet" && item._id.toString() !== cancellingItem._id.toString()
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
                let userWallet=await Wallet.findOne({userId})
                if(!userWallet){
                    userWallet = new Wallet({ userId: order.userId, balance: 0, transactions: [] });
                }

                userWallet.balance+=cancellingItem.price;
                userWallet.transactions.push({
                    amount:cancellingItem.price,
                    type:"credit",
                    description:`Refund for ${cancellingItem.productName} (Order ${order.orderId})`
                })
                await userWallet.save();
                cancellingItem.refundStatus = "Refunded to your wallet";
                cancellingItem.refundedOn = new Date();

                order.refundedAmount += cancellingItem.price;

				const finalTotalPrice=order.orderItems
					.filter((item)=>{
						return item._id.toString() !== cancellingItem._id.toString() && item.refundStatus !== "Refunded to your wallet"
					})
					.reduce((totalPrice,item)=>{
						return totalPrice + item.totalSalePrice
					},0)

				order.finalTotalPrice=finalTotalPrice;
				order.finalTotalAmount=finalTotalPrice;//because couponDiscount=0 to decrease from the sale price. means sale price is the total amount

				const finalTotalOfferDiscount=order.orderItems
						.filter((item)=>{
							return item.refundStatus !== "Refunded to your wallet" && item._id.toString() !== cancellingItem._id.toString()
						})
						.reduce((totalOfferDiscount,item)=>{
							return totalOfferDiscount+item.offerDiscount
						},0)

				order.finalTotalOfferDiscount=finalTotalOfferDiscount;
				
				await order.save()
            }
        }

        if(order.paymentMethod === "Cash on Delivery"){
            if(order.appliedCoupons.length > 0){

                //caluculating the current order total price after the cancelling the order.
                const currentOrderTotalPrice = order.orderItems
                        .filter((item)=>{
                            return item.itemStatus !== DELIVERY_STATUS.CANCELLED && item._id.toString() !== cancellingItem._id.toString()
                        })
                        .reduce((total,item)=>{
                            return total + item.price + item.couponDiscount
                        },0)
                
                //now checking new order total price is meeting mininmum purchase amount for coupon discount
                const applicableCoupons=order.appliedCoupons.filter((appliedCoupon)=>{
                    return appliedCoupon.minPurchase <= currentOrderTotalPrice
                })

                if(applicableCoupons.length > 0){
                    //re-calculate coupon discount for the current products excluding the cancelling product

                    for(const item of order.orderItems){
                        //prevent coupon discount calculation for cancelling item,
                        //and already cancelled item
                        if(item._id.toString() === cancellingItem._id.toString() || item.itemStatus === DELIVERY_STATUS.CANCELLED){
                            continue;
                        }

                        const itemTotalPrice=item.price+item.couponDiscount;
                        let itemTotalCouponDiscount=0

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

                                itemTotalCouponDiscount+=discount;
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

                        item.couponDiscount = itemTotalCouponDiscount;
						item.price = item.totalSalePrice - itemTotalCouponDiscount;
						item.finalPaidAmount = item.totalSalePrice - itemTotalCouponDiscount;
						item.finalCouponDiscount = itemTotalCouponDiscount
                        await order.save();
                    } 
                }

                if(applicableCoupons.length === 0){
                    //which means, no need to calcualte the coupon discount
                    //all item will be bought by sale price.
                    //still, we need to set the item price to sale price, and coupon discount to zero
                    //if there was discount before cancelling the order.
                    for(const item of order.orderItems){
                        item.price = item.totalSalePrice;
                        item.finalPaidAmount = item.totalSalePrice;
                        item.couponDiscount = 0;
						item.finalCouponDiscount = 0;
                        await order.save()
                    }


                }
                
            }

            if(order.appliedCoupons.length === 0){
                //we only needed to make the item status to = "cancelled"
                //that is already done in the restoreStock() function.
                //so we don't have anything to do in this block.
            }

			//updating the order level details
			//the cancelling item's details will be excluded
			//eg: in the total amount, the cancelling item's amount will be decreased
			//we are storing the keeping items' price details only.
            let totalMrp=0, totalOfferDiscount=0, totalCouponDiscount=0, totalPrice=0, totalAmount=0;
            for(const item of order.orderItems){
                if(item._id.toString() !== cancellingItem._id.toString() && item.itemStatus !== "Cancelled"){
                    totalMrp+=item.totalMrp;
                    totalOfferDiscount+=item.offerDiscount;
                    totalCouponDiscount+=item.finalCouponDiscount;
                    totalPrice+=item.totalSalePrice;
                    totalAmount+=item.finalPaidAmount;
                }
            }

            order.totalMrp=totalMrp;

            order.totalOfferDiscount=totalOfferDiscount;
            order.finalTotalOfferDiscount=totalOfferDiscount;

            order.totalCouponDiscount=totalCouponDiscount;
            order.finalTotalCouponDiscount=totalCouponDiscount;

            order.totalPrice=totalPrice;
			order.finalTotalPrice-totalPrice;

            order.totalAmount=totalAmount;
			order.finalTotalAmount=totalAmount;

            await order.save();

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


        //  Update order refund summary
        const allRefunded = order.orderItems.every(i => i.refundStatus === "Refunded to your wallet");
        const someRefunded = order.orderItems.some(i => i.refundStatus === "Refunded to your wallet");

        if (allRefunded) {
            order.refundStatus = "Refunded";
        } else if (someRefunded) {
            order.refundStatus = "Partially Refunded";
        }

        await order.save();

        res.json({ success: true, message: "Item cancelled successfully" });

    } catch (error) {
        console.log("cancelOrderItem() error =>", error);
        res.status(STATUS_CODES.INTERNAL_ERROR).json({ success: false, message: "Something went wrong" });
    }
};







// // Cancel entire order
// const cancelWholeOrder = async (req, res) => {
//   try {
//     const userId = req.session.user || req.session.passport?.user;
//     if (!userId) return res.status(401).json({ success: false, message: "Login required" });

//     const { orderId ,reason} = req.body;

//     const order = await Order.findOne({ orderId, userId });
//     if (!order) return res.status(404).json({ success: false, message: "Order not found" });

//     // Block cancellation if shipped/delivered items exist
//     if (order.orderItems.some(i => ["Shipped", "Delivered"].includes(i.itemStatus))) {
//       return res.status(STATUS_CODES.BAD_REQUEST).json({
//         success: false,
//         message: "Some items are already shipped/delivered. Order cannot be cancelled."
//       });
//     }

//     // Allow cancel only if order is in these statuses
//     if (!["Pending", "Partially Cancelled"].includes(order.orderStatus)) {
//       return res.status(STATUS_CODES.BAD_REQUEST).json({ success: false, message: "Order cannot be cancelled at this stage" });
//     }

//     const pendingItems=order.orderItems.filter((item)=>{
//       return item.itemStatus==="Pending"
//     })

//     let totalMrpOfPendingItems=0;
//     let totalOfferDiscountOfPendingItems=0;
//     let totalCouponDiscountOfPendingItems=0;
//     let totalPriceOfPendingItems=0;
//     let totalAmountOfPendingItems=0;

//     pendingItems.forEach((item)=>{
//       totalMrpOfPendingItems+=item.mrp;
//       totalOfferDiscountOfPendingItems+=item.offerDiscount;
//       totalCouponDiscountOfPendingItems+=item.couponDiscount;
//       totalPriceOfPendingItems+=(item.price+item.offerDiscount);
//       totalAmountOfPendingItems+=item.price;
//     })

//     order.totalMrp-=totalMrpOfPendingItems;
//     order.offerDiscount-=totalOfferDiscountOfPendingItems;
//     order.totalCouponDiscount-=totalCouponDiscountOfPendingItems;
//     order.totalPrice-=totalPriceOfPendingItems;
//     order.totalAmount-=totalAmountOfPendingItems;


//     // Restore stock and change status to "cancelled" for all Pending items,
//     await restoreStock(order.orderItems,reason);

//     // Track total refunded (for wallet)
//     let totalWalletRefund = 0;

//     // Loop through each item
//     order.orderItems.forEach(item => {
//       if (item.itemStatus === "Cancelled") {
//        if (order.paymentMethod === "Cash on Delivery") {
//           item.refundStatus = "Not Initiated";
//         } else if (order.paymentMethod === "TeeSpace Wallet" && order.paymentStatus === "Paid" || order.paymentMethod === "Online Payment" && order.paymentStatus === "Paid") {
//           if (item.refundStatus !== "Refunded") {
//             totalWalletRefund += item.price;
//             item.refundStatus = "Refunded";
//             item.refundedOn = new Date();
//           }
//         }
//       }
//     });

//     // Refund wallet if needed
//     if (totalWalletRefund > 0) {
//       let userWallet = await Wallet.findOne({ userId });
//       if(!userWallet){
//           userWallet = new Wallet({ userId: order.userId, balance: 0, transactions: [] });
//       }
//       if (userWallet) {
//         userWallet.balance += totalWalletRefund;
//         userWallet.transactions.push({
//           type: "credit",
//           amount: totalWalletRefund,
//           description: `Refund for cancelled order ${order.orderId}`,
//           createdAt: new Date()
//         });
//         await userWallet.save();
//       }
//     }



//     // Determine order-level status
//     const allStatuses = order.orderItems.map(i => i.itemStatus);
//     const anyRefunded = order.orderItems.some(i => i.refundStatus === "Refunded");


//     if (allStatuses.every(s => s === "Cancelled")) {
//         order.orderStatus = "Cancelled";
//         order.refundStatus = anyRefunded ? "Refunded" : "Not Initiated";
//     }

//     if(allStatuses.includes('Delivered')){
//         order.orderStatus = "Delivered";

//         const deliveredDates=order.orderItems
//             .map((item)=>item.deliveredOn)
//             .filter((date)=>date)
//         deliveredDates.sort((a,b)=>a-b);
//         const latestDeliveredDate=deliveredDates[latestDeliveredDate.length-1];
//         order.deliveredOn=latestDeliveredDate;
//     }

//     await order.save();

//     res.json({
//       success: true,
//       message: "Order cancelled successfully",
//       refundedAmount: totalWalletRefund > 0 ? totalWalletRefund : undefined
//     });

//   } catch (error) {
//     console.error("cancelWholeOrder() error =>", error);
//     res.status(STATUS_CODES.INTERNAL_ERROR).json({ success: false, message: "Something went wrong" });
//   }
// };



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
      return res.status(STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Some items are already shipped/delivered. Order cannot be cancelled."
      });
    }

    // Allow cancel only if order is in these statuses
    if (!["Pending", "Partially Cancelled"].includes(order.orderStatus)) {
      return res.status(STATUS_CODES.BAD_REQUEST).json({ success: false, message: "Order cannot be cancelled at this stage" });
    }


    if(order.paymentMethod === "TeeSpace Wallet" || order.paymentMethod === "Online Payment"){
		const refundAmount=order.totalAmount - order.refundedAmount;

		let userWallet=await Wallet.findOne({userId})
		if(!userWallet){
			userWallet = new Wallet({ userId: order.userId, balance: 0, transactions: [] });
		}

		userWallet.balance+=refundAmount;
		userWallet.transactions.push({
			amount:refundAmount,
			type:"credit",
			description:`Refund for cancelled order: ${order.orderId}`
		})
		await userWallet.save();

		//update every "pending" item's return status
		for(const item of order.orderItems){
			if(item.itemStatus === "Pending"){
				item.refundStatus = "Refunded to your wallet";
				item.refundedOn = new Date();
			}
		}
		await order.save();

    }

    if(order.paymentMethod === "Cash on Delivery"){
		let totalMrp=0,totalOfferDiscount=0,totalPrice=0,totalAmount=0;
		for(const item of order.orderItems){
			totalMrp += item.mrp;
			totalOfferDiscount+=item.offerDiscount;
			totalCouponDiscount+=item.couponDiscount;
			totalPrice+=(item.mrp - item.offerDiscount);
			totalAmount+=(item.price - item.couponDiscount);
		}

		order.totalMrp=totalMrp;
		order.totalOfferDiscount=totalOfferDiscount;
		order.totalCouponDiscount=totalCouponDiscount;
		order.totalPrice=totalPrice;
		order.totalAmount=totalAmount;

		await order.save();
    }


    // Restore stock and change status to "cancelled" for all Pending items,
    await restoreStock(order.orderItems,reason);


    // Determine order-level status
    const allStatuses = order.orderItems.map(i => i.itemStatus);
    const anyRefunded = order.orderItems.some(i => i.refundStatus === "Refunded to your wallet");


    if (allStatuses.every(s => s === "Cancelled")) {
        order.orderStatus = "Cancelled";
        order.refundStatus = anyRefunded ? "Refunded to your wallet" : null;
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
      message: "Order cancelled successfully"
    });

  } catch (error) {
    console.error("cancelWholeOrder() error =>", error);
    res.status(STATUS_CODES.INTERNAL_ERROR).json({ success: false, message: "Something went wrong" });
  }
};







const getInvoice = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate("userId");k
    
    if (!order) return res.status(404).send("Order not found");
    if (!order.invoice?.generated) return res.status(STATUS_CODES.BAD_REQUEST).send("Invoice not generated yet");

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
    res.status(STATUS_CODES.INTERNAL_ERROR).send("Internal server error");
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





export default {
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
    retryPaymentFromOrderDetailsPage,
    cancelOrderItem,
    cancelWholeOrder,
    getInvoice,
    returnOrderItem
}

