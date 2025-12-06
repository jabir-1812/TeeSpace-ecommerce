const Status=require('../../constants/statusCodes')
const User=require('../../models/userSchema');
const Product=require('../../models/productSchema');
const Address=require('../../models/addressSchema');
const Cart=require('../../models/cartSchema');
const Wallet=require('../../models/walletSchema')
const { ObjectId } = require('mongodb');
const { default: mongoose } = require("mongoose");
const Coupon = require('../../models/couponSchema');
const ejs = require("ejs");
const path = require("path");
// const { default: products } = require('razorpay/dist/types/products');

// const { default: products } = require('razorpay/dist/types/products');
require('dotenv').config();



const loadCheckoutPage = async (req, res) => {
  try {
    const userId = req.session.user || req.session.passport?.user;
    const user = await User.findById(userId);
    if (!user) return res.redirect('/login')

    //fetch wallet
    const userWallet=await Wallet.findOne({userId})
    if(!userWallet){
      userWallet=await Wallet.create({userId})
    }

    // Fetch addresses
    const findAddresses = await Address.findOne({ userId });
    const addresses = findAddresses ? findAddresses.address : [];


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
      //userCart will be look like this:
      // userCart={
      //   _id:"",
      //   userId:"",
      //   items:[
      //     {productId:{
      //       productName:"",
      //       productImage:"",
      //       salePrice:0,
      //       regularPrice:0,
      //       brand:{
      //         brandName:""
      //       },
      //      category:{
      //        name:""
      //      }
      //     },
      //     quantity:0
      //     },
      //     {productId:"",....},{productId:"",...}
      //   ]
      // }

    if (!userCart) {
      return res.render("user/checkout/checkout", {
        title: "Checkout page",
        addresses,
        user,
        isCartUpdated:false,
        userCart: null,
        cartLength: 0,
        totalPrice:0,
        totalAmount: 0,
        razorPayKeyId:process.env.RAZORPAY_KEY_ID,
        userWallet,
        appliedCoupons:[],
        totalDiscountFromAllCoupons:"",
        applicableCouponsCodes:null
      });
    }

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
        await userCart.save()
    }

    let totalPrice=0;
    let totalAmount = 0;
    let isCartUpdated = false;//initially set as false.


     // Check each item quantity vs stock
    for (let i = 0; i < userCart.items.length; i++) {
      let item = userCart.items[i];
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
    }


    //if total===0, no need to calculate coupon discounts, just render the page.
    if (totalPrice===0) {
      return res.render("user/checkout/checkout", {
        title: "Checkout page",
        addresses,
        user,
        isCartUpdated,
        userCart,
        cartLength: userCart.items.length,
        totalPrice:0,
        totalAmount: 0,
        razorPayKeyId:process.env.RAZORPAY_KEY_ID,
        userWallet,
        appliedCoupons:[],
        totalDiscountFromAllCoupons:null,
        applicableCouponsCodes:null
      });
    }
    //checking applied coupons
    //if any applied coupon, calculating the discount amount
    if(userCart.appliedCoupons.length>0){
        const appliedCouponIds=userCart.appliedCoupons.map((appliedCoupon)=>{
            return appliedCoupon.couponId;
        })
        //fetching all applied coupon's original doc with the coupon ids
        const now = new Date();
        const appliedCoupons = await Coupon.find({
            _id: { $in: appliedCouponIds },
            isActive: true,
            expiryDate: { $gt: now },
            startDate: { $lt: now }
        });


        //checking if the applied coupons are meeting minPurchase, if not it will be filtered out
        const validCoupons = appliedCoupons.filter(c => totalPrice >= c.minPurchase)
        //keeping the couponsIds that pass minPurchase amount
        const validCouponIds=validCoupons.map(c => c._id.toString());

        //removing the coupons that not met minPurchase amount
        userCart.appliedCoupons = userCart.appliedCoupons.filter(appliedCoupon =>
            validCouponIds.includes(appliedCoupon.couponId.toString())
            );
        
        //if any applied coupon filtered out because of not met minPurchase,
        //that coupon will also removed from user's cart.
        let shouldSave = false;
        if (userCart.appliedCoupons.length !== appliedCouponIds.length) shouldSave = true;

        for (const validCoupon of validCoupons) {
            //checking applicable products if it is category based coupon
            if (validCoupon.isCategoryBased) {
                const applicableCategoryIds = validCoupon.applicableCategories.map(applicableCatId => applicableCatId.toString());

                //returning the products that are in applicable cateogory
                // const hasApplicableProduct = userCart.items.some(item =>
                //     applicableCategoryIds.includes(item.productId.category?._id.toString())
                // );
                const hasApplicableProduct = userCart.items.some(item =>
                  item.productId?.category && applicableCategoryIds.includes(item.productId.category._id.toString())
                );


                //if there is no applicable products, remove the coupon from user's cart
                if (!hasApplicableProduct) {
                    userCart.appliedCoupons = userCart.appliedCoupons.filter(appliedCoupon =>
                    validCoupon._id.toString() !== appliedCoupon.couponId.toString()
                    );
                    shouldSave = true;
                }
            }
        }

        if (shouldSave) await userCart.save();

        const perProductDiscount=[];
        let appliedCouponsObj=[];
        if (userCart.appliedCoupons.length > 0) {
            // logic to calculate the coupon discount
            const cartTotalPrice=userCart.items.reduce((sum,item)=>{
              return sum+(item.productId.salePrice*item.quantity)
            },0)
            const appliedCouponIds=userCart.appliedCoupons.map((appliedCoupon)=>{return appliedCoupon.couponId})
            const appliedCoupons=await Coupon.find({_id:{$in:appliedCouponIds}})

            appliedCouponsObj=appliedCoupons.map((appliedCoupon)=>{
              return {
                couponId:appliedCoupon._id,
                code:appliedCoupon.couponCode,
                discountAmount:0
              }
            })

            for(const item of userCart.items){
              const itemTotalPrice=item.productId.salePrice * item.quantity;
              let itemTotalCouponDiscount=0
                for(const appliedCoupon of appliedCoupons){
                    if(appliedCoupon.isCategoryBased){
                        //if the product is other category, skip this coupon application for that product
                        // if(!appliedCoupon.applicableCategories.includes(item.productId.category.id)){
                        //     continue;
                        // }
                        if (!appliedCoupon.applicableCategories.some(catId => 
                            catId.toString() === item.productId.category._id.toString()
                        )) {
                            continue;
                        }

                        let discount=0
                        if(appliedCoupon.discountType==="percentage"){
                            discount=(itemTotalPrice*appliedCoupon.discountValue)/100
                        }else{
                          //if discount type is "fixed"
                            discount=(itemTotalPrice/cartTotalPrice)*appliedCoupon.discountValue;
                            // discount=appliedCoupon.discountValue
                        }

                        //cap max discount
                        if(
                          appliedCoupon.maxDiscountAmount &&
                           discount>appliedCoupon.maxDiscountAmount){
                          discount=appliedCoupon.maxDiscountAmount;
                        }
                        itemTotalCouponDiscount+=discount;
                        const appliedCpnObj=appliedCouponsObj.find((c)=>{
                          return c.couponId.toString()===appliedCoupon._id.toString()
                        })
                        appliedCpnObj.discountAmount+=discount;

                    }else{
                        let discount=0;
                        if(appliedCoupon.discountType==="percentage"){
                            discount=(itemTotalPrice*appliedCoupon.discountValue)/100
                        }else{
                          //if discount type is "fixed"
                            discount=(itemTotalPrice/cartTotalPrice)*appliedCoupon.discountValue;
                            // discount=appliedCoupon.discountValue
                        }

                        //cap max discount
                        if(appliedCoupon.discountType==="percentage" &&
                          appliedCoupon.maxDiscountAmount &&
                           discount>appliedCoupon.maxDiscountAmount){
                          discount=appliedCoupon.maxDiscountAmount;
                        }

                        itemTotalCouponDiscount+=discount;

                        const appliedCpnObj=appliedCouponsObj.find((c)=>{
                          return c.couponId.toString()===appliedCoupon._id.toString()
                        })
                        appliedCpnObj.discountAmount+=discount;
                    }
                }
                item.couponDiscount=itemTotalCouponDiscount;

                perProductDiscount.push({
                  productId:item.productId._id,
                  itemTotalPrice,
                  itemCouponDiscount:itemTotalCouponDiscount,
                  finalItemTotal:itemTotalPrice-itemTotalCouponDiscount
                })
            }
            
        }
        await userCart.save();

        // ----- Recalculate totals for all coupons -----
        // const allCoupons = [...userCart.appliedCoupons];
        const allCoupons = [...appliedCouponsObj];


        let totalDiscountFromAllCoupons = allCoupons.reduce(
          (sum, coupon) => sum + (coupon.discountAmount || 0),
          0
        );

        const totalAmount = totalPrice - totalDiscountFromAllCoupons;

        let cartObj=userCart.toObject();

        const applicableCouponsCodes=(await Coupon.find({minPurchase:{$lte:totalPrice}},{couponCode:1,_id:0})).map((coupon)=>coupon.couponCode)

        return res.render("user/checkout/checkout", {
          title: "Checkout page",
          isCartUpdated,
          addresses,
          user,
          userCart:cartObj,
          cartLength: cartObj.items.length,
          totalPrice,
          totalAmount:Math.round(totalAmount),
          razorPayKeyId:process.env.RAZORPAY_KEY_ID,
          userWallet,
          appliedCoupons:appliedCouponsObj,
          totalDiscountFromAllCoupons,
          applicableCouponsCodes:applicableCouponsCodes
        });
      }

      //if there is no applied coupon in user's cart
      //render the page without calculating the coupon discount
      if(userCart.appliedCoupons.length===0){
          await Cart.updateOne(
            { userId },
            { $set: { "items.$[].couponDiscount": 0 } }
          );
          //fetching new data
          userCart = await Cart.findOne({ userId })
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
      }

      let cartObj=userCart.toObject();
      const applicableCouponsCodes=(await Coupon.find({minPurchase:{$lte:totalPrice}},{couponCode:1,_id:0})).map((coupon)=>coupon.couponCode)

      res.render("user/checkout/checkout", {
        title: "Checkout page",
        isCartUpdated,
        addresses,
        user,
        userCart:cartObj,
        cartLength: cartObj.items.length,
        totalPrice,
        totalAmount:Math.round(totalAmount),
        razorPayKeyId:process.env.RAZORPAY_KEY_ID,
        userWallet,
        appliedCoupons:"",
        totalDiscountFromAllCoupons:"",
        applicableCouponsCodes:applicableCouponsCodes
      });

  } catch (error) {
    console.log("loadCheckoutPage() error:", error);
    res.redirect("/page-not-found");
  }
};


const editAddress = async (req, res) => {
    try {
        const { addressId, addressType, name, city, landMark, state, pincode, phone, altPhone } = req.body;
        console.log('addressId & addressType====>', addressId, addressType);

        const userId = req.session.user || req.session.passport?.user;
        const user = await User.findById(userId);
        if (!user) return res.status(404).send("User not found");

        // Update in DB
        await Address.updateOne(
            { userId, "address._id": addressId },
            {
                $set: {
                    "address.$.addressType": addressType,
                    "address.$.name": name,
                    "address.$.city": city,
                    "address.$.landMark": landMark,
                    "address.$.state": state,
                    "address.$.pincode": pincode,
                    "address.$.phone": phone,
                    "address.$.altPhone": altPhone
                }
            }
        );

        // Fetch the updated address
        const updatedDoc = await Address.findOne(
            { userId, "address._id": addressId },
            { "address.$": 1 } // only return the matching address
        );

        const updatedAddress = updatedDoc.address[0];


        //Fetch all the addresses
        const findAddresses = await Address.findOne({ userId });
        const addresses = findAddresses ? findAddresses.address : [];
        res.render("user/checkout/checkout-partials/4address-forms",{
            layout:false,
            addresses,
            user
        })


    } catch (error) {
        console.log("error in editAddress() in checkoutController====>", error);
        res.status(Status.INTERNAL_ERROR).json({success:false, message: "Something went wrong" });
    }
};



const addNewAddress = async (req, res) => {
    try {
        const userId = req.session.user || req.session.passport?.user;
        const user = await User.findById(userId);
        if (!user) return res.status(404).send("User not found");
        const { addressType, name, city, landMark, state, pincode, phone, altPhone } = req.body;

        let newAddressEntry = { addressType, name, city, landMark, state, pincode, phone, altPhone };

        const findUserAddress = await Address.findOne({ userId: userId });

        if (!findUserAddress) {
            // User has no addresses yet
            const newAddress = new Address({
                userId: userId,
                address: [newAddressEntry]
            });
            await newAddress.save();
        } else {
            // Push new address to existing list
            findUserAddress.address.push(newAddressEntry);
            await findUserAddress.save();
        }

        //Fetch all the addresses
        const findAddresses = await Address.findOne({ userId });
        const addresses = findAddresses ? findAddresses.address : [];
       res.render("user/checkout/checkout-partials/4address-forms",{
            layout:false,
            addresses,
            user
        })

    } catch (error) {
        console.log("checkoutController====>addNewAddress() error:", error);
        res.status(Status.INTERNAL_ERROR).json({ message: "Something went wrong" });
    }
};



const changeCartQuantity = async (req, res) => {
  try {
    const userId = req.session.user || req.session.passport?.user;
    const { productId, count } = req.body;

    // 🔹 Validate input
    if (!mongoose.Types.ObjectId.isValid(productId))
      return res.status(Status.BAD_REQUEST).json({ success: false, message: "Invalid product ID" ,reload:true});

    if (typeof count !== "number" || isNaN(count))
      return res.status(Status.BAD_REQUEST).json({ success: false, message: "Invalid count value",reload:true });

    // 🔹 Fetch cart & product in parallel
    const [cart, product] = await Promise.all([
      Cart.findOne({ userId }),
      Product.findById(productId)
    ]);

    if (!cart) return res.status(404).json({ success: false, message: "Cart not found",reload:true });
    if (!product) return res.status(Status.BAD_REQUEST).json({ success: false, message: "Product not found",reload:true});
    if(product.isBlocked || product.status !== "Available"){
      return res.status(Status.BAD_REQUEST).json({message:"Product is Unavailable",reload:true})
    }

    //get the product item element from the cart items[] with the product ID
    const item = cart.items.find(item => item.productId.toString() === productId);
    if (!item) return res.status(Status.BAD_REQUEST).json({ success: false, message: "Product not in cart",reload:true });

    //get the product stock
    const productStock = product.quantity;

    // 🔹 Handle stock conditions
    if (productStock === 0) {
      await Cart.updateOne(
        { userId, "items.productId": productId },
        { $set: { "items.$.quantity": 0 } }
      );
      return res.status(Status.BAD_REQUEST).json({message:"Product is out of stock",reload:true})
    }

    const newQty = item.quantity + count;

    if (newQty <= 0) {
      await Cart.updateOne(
        { userId },
        { $pull: { items: { productId } } }
      );
      return res.json({ success: true, message: "Item removed from cart",reload:true });
    }

    if (newQty > productStock) {
      await Cart.updateOne(
        { userId, "items.productId": productId },
        { $set: { "items.$.quantity": productStock } }
      );
      return res.status(Status.BAD_REQUEST).json({message:`Available stock is: ${productStock}`})
    }

    // 🔹 Update quantity
    await Cart.updateOne(
      { userId, "items.productId": productId },
      { $inc: { "items.$.quantity": count } }
    );

    return res.json({success:true,message:"Quantity updated successfully",reload:true})
  } catch (error) {
    console.error("changeCartQuantity() error:", error);
    res.status(Status.INTERNAL_ERROR).json({ success: false, error: "Server error" });
  }
};



const deleteCartItem =async (req,res)=>{
 try {
    const userId = req.session.user || req.session.passport?.user;
    const productId = req.params.id;

    await Cart.updateOne(
      { userId: new mongoose.Types.ObjectId(String(userId)) },
      { $pull: { items: { productId: new mongoose.Types.ObjectId(String(productId)) } } }
    );

    res.status(Status.OK).json({ status: true, message: "Item removed" });
  } catch (error) {
    console.log('deleteCartItem() error:', error);
    res.status(Status.INTERNAL_ERROR).json({ status: false, error: "Server error" });
  }
}




const applyCoupon= async(req,res)=>{
  try {
    const userId = req.session.user || req.session.passport?.user;

    const {couponCode}=req.body;
    const coupon=await Coupon.findOne({couponCode})

    //coupon validation
    if(!coupon) return res.status(Status.BAD_REQUEST).json({success:false,message:"Inavlid coupon code"})
    if(coupon.userId && coupon.userId.toString()!==userId.toString()) return res.status(Status.BAD_REQUEST).json({message:"This coupon is not available for you"})
    if(!coupon.isActive) return res.status(Status.BAD_REQUEST).json({success:false,message:"Coupon is not active"})
    if(coupon.expiryDate < new Date()) return  res.status(Status.BAD_REQUEST).json({success:false,message:"Coupon expired"})
    if(coupon.startDate > new Date()) return  res.status(Status.BAD_REQUEST).json({success:false,message:"Coupon is not active"})

    if(!userId) return res.status(Status.BAD_REQUEST).json({message:"session expired",reload:true})
    const userCart = await Cart.findOne({ userId })
        .populate({
            path: 'items.productId',
            select: 'productName category brand quantity salePrice regularPrice productImage isBlocked',
            populate:[ 
                  {
                    path: 'category',
                    select: 'name'
                  },
                  {
                    path:"brand",
                    select:"brandName"
                  }
              ]
        });

    //userCart will look like this:
    // userCart={
    //     userId:"",
    //     items:[{
    //         productId:{
    //             _id:"",
    //             quantity:"",
    //             category:{
    //                 _id:"",
    //                 name:""
    //             }
    //         },
    //         quantity:""
    //     },{...},{...}]
    // }
    if(!userCart || userCart.items.length===0){
        const [cartHtml,couponHtml, priceDetailsHtml] = await Promise.all([
            ejs.renderFile(
            path.join(__dirname, "../../views/user/checkout/checkout-partials/2cart-items.ejs"),
            { userCart:null, totalAmount:0},
            { async: true }
            ),
            ejs.renderFile(
            path.join(__dirname, "../../views/user/checkout/checkout-partials/coupon-forms.ejs"),
            {applicableCouponsCodes:null},
            { async: true }
            ),
            ejs.renderFile(
            path.join(__dirname, "../../views/user/checkout/checkout-partials/price details.ejs"),
            { totalPrice:0, totalAmount:0 ,razorPayKeyId:process.env.RAZORPAY_KEY_ID},
            { async: true }
            )
        ]);


        return res.status(Status.BAD_REQUEST).json({
            message:"Your cart is empty",
            html:{cartItems:cartHtml,priceDetails:priceDetailsHtml,couponForm:couponHtml}
        })
    }
    if(userCart.appliedCoupons.length>=3){
      return res.status(Status.BAD_REQUEST).json({message:"cannot apply more than 3 coupon"})
    }

    // ----- Check if already applied -----
    const alreadyApplied = userCart.appliedCoupons.some(
      (c) => c.couponId?.toString() === coupon._id.toString()
    );
    if (alreadyApplied)
      return res.status(Status.BAD_REQUEST).json({ success: false, message: "Coupon already applied" });

    if(coupon.isCategoryBased){
        const applicableCategoryIds=coupon.applicableCategories;

        //checking if there is applicable products
        let applicableProducts=[]
        for(const id of applicableCategoryIds){
            for(const item of userCart.items){
                if(id.toString()===item.productId.category?._id.toString()){
                    applicableProducts.push(item.productId.category._id)
                }
            }
        }

        //if there is no product having this coupon code, stop.
        if(applicableProducts.length===0){
            return res.status(Status.BAD_REQUEST).json({success:false,message:"These categories do not have this coupon discount"})
        }
    }

    

    //re-checking the: cart item qty vs product qty
    //checking if product is available or not
    for(const item of userCart.items){
        const productId=item.productId._id;
        const product=await Product.findOne({_id:productId});

        if(!product){
          //removing the applied coupon for entire cart
          await Cart.updateOne(
            { userId }, // filter
            { $set: { appliedCoupons: [] } } // atomic update
          );

            return res.status(Status.BAD_REQUEST).json({
                message:`Product not available or not found`,
                reload:true
            })
        } 

        if(product.isBlocked || product.status!=="Available"){
          //removing the applied coupon for entire cart
          await Cart.updateOne(
            { userId }, // filter
            { $set: { appliedCoupons: [] } } // atomic update
          );

            return res.status(Status.BAD_REQUEST).json({
                message:`${product.productName} is blocked or not available`,
                reload:true
            })
        } 

        if(product.quantity<item.quantity){
            const result = await Cart.updateOne(
              { userId, "items.productId": productId },
              {
                $set: {
                  "items.$.quantity": product.quantity,
                  appliedCoupons: []//clearing the applied coupons
                }
              }
            );

            
            //after updating we fetching new db data.
            const userCart=await Cart.findOne({userId})
              .populate({
                  path:"items.productId",
                  select:"productName category brand salePrice regularPrice productImage isBlocked quantity",
                  populate:[
                      {
                          path:"brand",
                          select:"brandName"
                      },
                      {
                          path:"category",
                          select:"name"
                      }
                  ]
            })
            let totalPrice=0,totalAmount=0;

            // Check each item quantity vs stock
            for (let item of userCart.items) {
              const price = item.productId?.salePrice || 0;
              totalPrice += price * item.quantity;
              totalAmount += price * item.quantity;
            }

            const applicableCouponsCodes=(await Coupon.find({minPurchase:{$lte:totalPrice}},{couponCode:1,_id:0})).map((coupon)=>coupon.couponCode)


            const [cartHtml,couponHtml, priceDetailsHtml] = await Promise.all([
                ejs.renderFile(
                path.join(__dirname, "../../views/user/checkout/checkout-partials/2cart-items.ejs"),
                { userCart, totalAmount:Math.round(totalAmount)},
                { async: true }
                ),
                ejs.renderFile(
                path.join(__dirname, "../../views/user/checkout/checkout-partials/coupon-forms.ejs"),
                {applicableCouponsCodes:applicableCouponsCodes},
                { async: true }
                ),
                ejs.renderFile(
                path.join(__dirname, "../../views/user/checkout/checkout-partials/price details.ejs"),
                { totalPrice, totalAmount:Math.round(totalAmount) ,razorPayKeyId:process.env.RAZORPAY_KEY_ID},
                { async: true }
                )
            ]);

            return res.status(Status.BAD_REQUEST).json({
                message:`Sorry, ${product.productName} only ${product.quantity} available right now`,text:"Please re-apply the coupons",
                html:{cartItems:cartHtml,priceDetails:priceDetailsHtml,couponForm:couponHtml}
            })
        }
    } 

    if(userCart.appliedCoupons.length===0){
      for(const item of userCart.items){
        item.couponDiscount=0;
      }
    }
    //calculate coupon discount
    let totalPrice=0,eligibleAmount=0;

    for(let item of userCart.items){
        //find product
        const productId=item.productId._id;
        const product=await Product.findOne({_id:productId})

        //calculate item's total price (price * qty)
        //caluculate whole cart total price
        const itemTotal=product.salePrice * item.quantity;
        totalPrice+=itemTotal;

        //checking eligible for coupon discount
        if(
            coupon.isCategoryBased && 
            coupon.applicableCategories?.length>0 && 
            coupon.applicableCategories.some((catId)=>
                {return catId.toString()===product.category.toString()})
        ){
            eligibleAmount+=itemTotal;

        }else if(!coupon.isCategoryBased){
            //if the coupon is for all product
            eligibleAmount=totalPrice;
        }
    }



    if(totalPrice < coupon.minPurchase){
        return res.status(Status.BAD_REQUEST).json({message:`Minimum purchase ${coupon.minPurchase} required`})
    }

    let couponDiscount=0;

    if(coupon.discountType === "percentage"){
        couponDiscount = (eligibleAmount * coupon.discountValue)/100;
    }else{
        //if fixed discount
        couponDiscount=coupon.discountValue;
    }

    // cap max discount
    if (
      coupon.discountType === "percentage" &&
      coupon.maxDiscountAmount &&
      couponDiscount > coupon.maxDiscountAmount
    ) {
      couponDiscount = coupon.maxDiscountAmount;
    }

    // ----- Proportionally distribute per-product coupon discount -----
    const perProductDiscounts=[];
    for(let item of userCart.items){
        const productId=item.productId._id;
        const product=await Product.findOne({_id:productId})

        const itemTotalPrice = product.salePrice * item.quantity;

        let itemCouponDiscount=0;

        const isEligible=
            (!coupon.isCategoryBased &&
                eligibleAmount > 0 &&
                totalPrice > 0 || 
                (coupon.isCategoryBased &&
                    coupon.applicableCategories?.some((catId)=>{
                        return catId.toString() === product.category.toString()
                    })
                )
            );
        if(isEligible){
            const base = coupon.isCategoryBased ? eligibleAmount : totalPrice;//base=total price or eligible amount 
            itemCouponDiscount=(itemTotalPrice/base) * couponDiscount;
        }

        perProductDiscounts.push({
            productId: product._id,
            itemTotalPrice,
            itemCouponDiscount,
            finalItemTotal: itemTotalPrice - itemCouponDiscount,
        });
        // perProductDiscounts=[
        //   {
        //     productId:"",
        //     itemTotalPrice:1000,
        //     itemCouponDiscount:100,
        //     finalItemTotal:900
        //   },
        //   {...},{...}
        // ]
    }

    // ----- Add this coupon to applied coupons -----
    userCart.appliedCoupons.push({
      couponId: coupon._id,
      code: coupon.couponCode,
      discountAmount: couponDiscount,
    });
    

    for(const item of userCart.items){
      //finding the every cartItem's discount from the perProductDiscount
      const cartItem=perProductDiscounts.find((product)=>{
       return product.productId.toString()===item.productId._id.toString()
      })
      item.couponDiscount+=cartItem.itemCouponDiscount;
    }

    // ----- Recalculate totals for all coupons -----
    const allCoupons = [...userCart.appliedCoupons];

    let totalDiscountFromAllCoupons = allCoupons.reduce(
      (sum, coupon) => sum + (coupon.discountAmount || 0),
      0
    );

    const totalAmount = totalPrice - totalDiscountFromAllCoupons;

    await userCart.save();

   
      let cartObj=userCart.toObject();
    // Merge per-product discounts directly into cart items
    cartObj.items = cartObj.items.map(item => {
        const discountInfo = perProductDiscounts.find(
            d => d.productId.toString() === item.productId._id.toString()
            
        );
        return {
            ...item,
            product_Id:discountInfo.productId,
            itemTotalPrice:discountInfo.itemTotalPrice,
            itemCouponDiscount: discountInfo?.itemCouponDiscount || 0,
            finalItemTotal: discountInfo?.finalItemTotal || (item.productId.salePrice * item.quantity)
        };
    });


    const applicableCouponsCodes=(await Coupon.find({minPurchase:{$lte:totalPrice}},{couponCode:1,_id:0})).map((coupon)=>coupon.couponCode)

    const [cartHtml,couponHtml, priceDetailsHtml] = await Promise.all([
            ejs.renderFile(
            path.join(__dirname, "../../views/user/checkout/checkout-partials/2cart-items.ejs"),
            { userCart:cartObj, totalAmount:Math.round(totalAmount)},
            { async: true }
            ),
            ejs.renderFile(
            path.join(__dirname, "../../views/user/checkout/checkout-partials/coupon-forms.ejs"),
            {
                applicableCouponsCodes,
                appliedCoupons:allCoupons.map((coupon)=>({
                    code:coupon.code,
                    discountAmount:coupon.discountAmount,
                    couponId:coupon.couponId,
                }))
            },
            { async: true }
            ),
            ejs.renderFile(
            path.join(__dirname, "../../views/user/checkout/checkout-partials/price details.ejs"),
            { 
                razorPayKeyId:process.env.RAZORPAY_KEY_ID,
                totalPrice,
                totalAmount:Math.round(totalAmount), 
                totalDiscountFromAllCoupons,
                appliedCoupons:allCoupons.map((coupon)=>({
                    code:coupon.code,
                    discountAmount:coupon.discountAmount
                }))
            },
            { async: true }
            )
        ]);

    return res.json({
      success: true,
      message: "Coupon applied successfully",
      totalPrice,
      totalDiscountFromAllCoupons,
      totalAmount:Math.round(totalAmount),
      appliedCoupons: allCoupons.map((c) => ({
        code: c.code,
        discountAmount: c.discountAmount,
      })),
      userCart:cartObj,
      html:{
        cartItems:cartHtml,priceDetails:priceDetailsHtml,couponForm:couponHtml
      }
    });

  } catch (error) {
    console.error('applyCoupon() error == ',error)
    res.status(Status.INTERNAL_ERROR).json({success:false,message:"Something went wrong"})
  }
}


const removeCoupon = async (req,res)=>{
  try {
    const userId=req.session.user || req.session.passport?.user;
    const {couponCode,couponId}=req.body;

    // Convert to ObjectId safely
    const couponObjectId = new mongoose.Types.ObjectId(couponId);

    const result = await Cart.updateOne(
      { userId },
      { $pull: { appliedCoupons: { code:couponCode, couponId: couponObjectId } } }
    );

    if (result.modifiedCount > 0) {
      return res.json({ success: true, message: `${couponCode} removed`,reload:true});
    } else {
      // fallback if something is inconsistent
      await Cart.updateOne({ userId }, { $set: { appliedCoupons: [] } });
      return res.json({
        success: false,
        message:
          "Coupon mismatch found, all coupons removed. Please try again.",
        reload:true
      });
    }
  } catch (error) {
    console.error("removeCoupon() error",error);
    res.status(Status.INTERNAL_ERROR).json({message:"Something went wrong",reload:true})
  }
}





module.exports={
    loadCheckoutPage,
    editAddress,
    addNewAddress,
    changeCartQuantity,
    deleteCartItem,
    applyCoupon,
    removeCoupon
}
