const Status=require('../../constants/statusCodes')
const Coupon=require('../../models/couponSchema')
const Category=require('../../models/categorySchema')



const getCouponsPage = async (req,res)=>{
    try {
        const page = parseInt(req.query.page) || 1; // current page
        const limit = 10; // items per page
        const search = req.query.search || '';

        // Auto-update expired coupons
        await Coupon.updateMany(
            {
                expiryDate: { $lt: new Date() },
                isActive: { $ne: false }
            },
            { $set: { isActive: false } }
        );

        const query = search
            ? { couponCode: { $regex: search, $options: 'i' } } // case-insensitive search
            : {};

        const totalCoupons = await Coupon.countDocuments(query);
        const totalPages = Math.ceil(totalCoupons / limit);

        const coupons = await Coupon.find(query)
            .sort({ startDate: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        res.render('admin/coupon/coupon',{
            layout:"adminLayout",
            title:"Coupons",
            coupons,
            currentPage:page,
            totalPages,
            search
        })
    } catch (error) {
        console.log("getCouponsPage() error=====>",error);
        res.redirect('/admin/page-error')
    }
}


const getAddNewCouponPage =async (req,res)=>{
    try {
        const categories=await Category.find({isDeleted:false});
        res.render('admin/coupon/2add-new-coupon',{
            layout:"adminLayout",
            title:"Add new coupon",
            categories
        })
    } catch (error) {
        console.log("getAddNewCouponPage() error=====>",error)
        res.redirect('/admin/page-error')
    }
}


const addNewCoupon=async(req,res)=>{
    try {
        const {
            couponCode,discountType,discountValue,minPurchase,maxDiscountAmount,
            startDate,expiryDate,maxUses,description,applicableCategoryIds,excludedCategoryIds
        } = req.body;

        if(!couponCode) return res.status(Status.BAD_REQUEST).json({success:false,message:"Coupon code is required"})
        
        //  Check uniqueness
        const existing = await Coupon.findOne({ couponCode: couponCode.toUpperCase() });
        if (existing) return res.status(Status.BAD_REQUEST).json({ success:false,message: "Coupon code already exists" });

        // Prepare coupon data
        const couponData = {
        couponCode: couponCode.toUpperCase(),
        discountType,
        discountValue,
        minPurchase: minPurchase || 0,
        maxDiscountAmount,
        startDate,
        expiryDate,
        maxUses,
        description,
        };
        // Handle category-based coupon
        if ((applicableCategoryIds && applicableCategoryIds.length > 0) ||
            (excludedCategoryIds && excludedCategoryIds.length > 0)) {
                couponData.isCategoryBased = true;
                couponData.applicableCategories = applicableCategoryIds || [];
                couponData.excludedCategories = excludedCategoryIds || [];
        }

        // Create coupon
        const newCoupon = new Coupon(couponData);
        await newCoupon.save();

        res.status(Status.OK).json({
        success: true,
        message: "Coupon created successfully",
        coupon: newCoupon,
        });
    } catch (error) {
        console.log("addNewCoupon() error======>",error)
        res.status(Status.INTERNAL_ERROR).json({success:false,message:"Something went wrong"})
    }
}



const getEditCouponPage = async (req,res)=>{
    try {
        const couponId=req.params.couponId;
        // console.log("coupon ID=====>",couponId)
        const coupon=await Coupon.findById(couponId)
        if(!coupon){
            console.log("No coupon found with that coupon ID")
            return res.redirect('/admin/page-error')
        }
        const categories=await Category.find({isDeleted:false});

        res.render('admin/coupon/2edit-coupon',{
            layout:"adminLayout",
            title:"Edit Coupon",
            coupon,
            categories
        })
    } catch (error) {
        console.log("getEditCouponPage() error=====>",error);
        res.redirect('/admin/page-error')
    }
}


const editCoupon = async (req, res) => {
  try {
    const couponId = req.params.couponId;
    const coupon = await Coupon.findById(couponId);

    if (!coupon) {
      return res.status(404).json({ success: false, message: "Coupon not found" });
    }

    const {
      couponCode,
      discountType,
      discountValue,
      minPurchase,
      maxDiscountAmount,
      startDate,
      expiryDate,
      maxUses,
      description,
      applicableCategoryIds,
      excludedCategoryIds
    } = req.body;

    // Prepare update object
    const updateData = {
      couponCode,
      discountType,
      discountValue,
      minPurchase,
      maxDiscountAmount,
      startDate,
      expiryDate,
      maxUses,
      description,
    };

    // Handle category-based updates
    if (
      (applicableCategoryIds && applicableCategoryIds.length > 0) ||
      (excludedCategoryIds && excludedCategoryIds.length > 0)
    ) {
      updateData.isCategoryBased = true;
      updateData.applicableCategories = applicableCategoryIds || [];
      updateData.excludedCategories = excludedCategoryIds || [];
    } else {
      // If both are empty or not sent, reset category fields
      updateData.isCategoryBased = false;
      updateData.applicableCategories = [];
      updateData.excludedCategories = [];
    }

    await Coupon.updateOne({ _id: couponId }, { $set: updateData });

    res
      .status(200)
      .json({ success: true, message: "Coupon updated successfully" });
  } catch (error) {
    console.log("editCoupon() error =====>", error);
    res.status(Status.INTERNAL_ERROR).json({ success: false, message: "Something went wrong" });
  }
};



const deleteCoupon=async (req,res)=>{
    try {
        const couponId=req.params.couponId;
        console.log("coupon Id =====>",couponId)
        const coupon=await Coupon.findById(couponId)
        if(!coupon){
            return res.status(Status.BAD_REQUEST).json({success:false,message:"Coupon not found"})
        }

        await Coupon.deleteOne({_id:couponId})
        res.json({success:true,message:"Coupon deleted successfully"})
    } catch (error) {
        console.log("deleteCoupon() error======>",error)
        res.status(Status.INTERNAL_ERROR).json({message:"Something went wrong"})
    }
}


const deActivateCoupon = async (req,res)=>{
    try {
        console.log("deactivate coupon started working")
        const {couponId}=req.params;
        console.log("coupon Id=====>",couponId)
        const coupon= await Coupon.findById(couponId)
        console.log("coupon======>",coupon)
        if(!coupon) return res.status(Status.BAD_REQUEST).json({success:false,message:"Coupon not fouond"})
        
        await Coupon.updateOne({_id:couponId},{$set:{isActive:false}})
        res.json({success:true,message:"Coupon de-activated successfully"})
    } catch (error) {
        console.log("deActivateCoupon error======>",error)
        res.status(Status.INTERNAL_ERROR).json({message:"Something went wrong"})
    }
}

const activateCoupon = async (req,res)=>{
    try {
        const {couponId}=req.params;
        const coupon= await Coupon.findById(couponId)
        if(!coupon) return res.status(Status.BAD_REQUEST).json({success:false,message:"Coupon not fouond"})
        
        await Coupon.updateOne({_id:couponId},{$set:{isActive:true}})
        res.json({success:true,message:"Coupon de-activated successfully"})
    } catch (error) {
        console.log("deActivateCoupon error======>",error)
        res.status(Status.INTERNAL_ERROR).json({message:"Something went wrong"})
    }
}

module.exports={
    getCouponsPage,
    getAddNewCouponPage,
    addNewCoupon,
    getEditCouponPage,
    editCoupon,
    deleteCoupon,
    deActivateCoupon,
    activateCoupon
}