const Status=require('../../constants/statusCodes')
const Category=require('../../models/categorySchema');
const Product =require('../../models/productSchema')
const Offer = require('../../models/offerSchema')

const 
categoryInfo = async (req,res)=>{
    try {
        // Get all categories with pagination and search
        const ITEMS_PER_PAGE = 5;
        const page = parseInt(req.query.page) || 1;
        const search = req.query.search || '';

        const totalCategories = await Category.countDocuments({name:{$regex:".*"+search+".*",$options:"i"}})
        const categories=await Category.find({name:{$regex:".*"+search+".*",$options:"i"}})
        .sort({createdAt:-1})
        .skip((page - 1)* ITEMS_PER_PAGE)
        .limit(ITEMS_PER_PAGE)

        const products=await Product.aggregate([{$group:{_id:"$category",products:{$sum:1}}}])

        for(const c of categories){
          for(const p of products){
            if(c._id.toString()===p._id.toString()){
              c.products=p.products
            }
          }
        }

        res.render('./admin/category/2category',{
            layout:"adminLayout",
            title:"Categories",
            categories,
            totalCategories,
            search,
            totalPages:Math.ceil(totalCategories/ITEMS_PER_PAGE),
            currentPage:page
        })
        
    } catch (error) {
        console.log("error loading the category page:",error)
        res.redirect('/admin/page-error')
    }
}

//load add-category page
const loadAddCategoryPage = async (req,res)=>{
    try {
        res.render('./admin/category/add-category',{
            layout:"adminLayout",
            title:"Add Category",
            errors: null, 
            formData: {} 
        })
    } catch (error) {
        console.log("error loading the add-category page:",error)
        res.redirect('/admin/page-error');
    }
}

//add category
const addCategory = async (req,res)=>{
    try {
        const { categoryName, description } = req.body;
        
        const category = new Category({ name:categoryName, description:description || "NA" });
        await category.save();

        res.redirect('/admin/category');
    } catch (error) {
        if (error.name === 'ValidationError') {
            const errors = Object.values(error.errors).map(err => ({ msg: err.message }));
            res.render('./admin/category/add-category', {
                layout:"adminLayout",
                title:"Add category",
                errors,
                formData: req.body
            });
        } else {
            res.status(Status.INTERNAL_ERROR).send('Server Error');
            console.log("catch block error in adding category:",error);
            res.redirect("/admin/page-error");
        }
    }
}


//load edit category page
const loadEditCategory = async (req,res)=>{
    try {
        const category = await Category.findById(req.params.id);
        if (!category) {
            return res.redirect('/admin/category');
        }
        res.render('./admin/category/edit-category',{
            layout:"adminLayout",
            title:"Edit Category",
            category,
            errors: null
        })
    } catch (error) {
        console.log("edit-category page laoding error:",error)
        res.redirect('/admin/page-error')
    }
}

//edit category or update category
const editCategory = async (req,res)=>{
    try {
        const { categoryName, description } = req.body;
        const category = await Category.findById(req.params.id);
        if (!category) {
            return res.redirect('/admin/category');
        }
        
        category.name = categoryName;
        category.description = description;
        await category.save();
        
        res.redirect('/admin/category');
    } catch (error) {
        if (error.name === 'ValidationError') {
            const errors = Object.values(error.errors).map(err => ({ msg: err.message }));
            const category = await Category.findById(req.params.id);
            res.render('./admin/category/edit-category', {
                layout:"adminLayout",
                title:"Edit Category",
                category,
                errors
            });
        } else {
            res.redirect('/admin/page-error');
        }
    }
}


const addCategoryOffer = async (req, res) => {
  try {
    const { categoryId, percentage, startDate, endDate, description } = req.body;

    // 1️⃣ Check if category exists
    const category = await Category.findById(categoryId);
    if (!category) {
      return res.status(404).json({ status: false, message: "Category not found" });
    }

    // 2️⃣ Find products in this category
    const products = await Product.find({ category: category._id });

    // 3️⃣ Update each product's categoryOffer & salePrice if needed
    if (products.length > 0) {
      const bulkOps = products.map((product) => {
        const update = { categoryOffer: percentage };
        if (percentage > product.productOffer && percentage > product.brandOffer) {
          update.salePrice = product.regularPrice * (1 - percentage / 100);
        }
        return {
          updateOne: {
            filter: { _id: product._id },
            update: { $set: update },
          },
        };
      });

      if (bulkOps.length > 0) {
        await Product.bulkWrite(bulkOps);
      }
    }

    // 4️⃣ Update category with offer info
    await Category.updateOne(
      { _id: categoryId },
      {
        $set: {
          offer: percentage,
          offerStartDate: startDate || null,
          offerEndDate: endDate || null,
          offerDescription: description || "",
        },
      }
    );

    // 5️⃣ Sync to Offer collection (centralized)
    await Offer.findOneAndUpdate(
      { refId: category._id, type: "category" },
      {
        name: category.name,
        type: "category",
        refId: category._id,
        percentage,
        startDate: startDate || null,
        endDate: endDate || null,
        description: description || "",
        active: true,
      },
      { upsert: true } // create if not exists
    );

    // 6️⃣ Send response
    res.json({ status: true, message: "Category offer added successfully" });
  } catch (error) {
    console.error("Error adding category offer:", error);
    res.status(Status.INTERNAL_ERROR).json({ status: false, message: "Internal Server Error" });
  }
}



const removeCategoryOffer = async (req, res) => {
  try {
    const categoryId = req.body.categoryId;

    // Step 1: Find the category
    const category = await Category.findById(categoryId);
    if (!category) {
      return res
        .status(404)
        .json({ status: false, message: "Category not found" });
    }

    // Step 2: Reset category offer
    category.offer = 0;
    await category.save();

    // Step 3: Find all products in this category
    const products = await Product.find({ category: category._id });

    if (products.length > 0) {
      for (const product of products) {
        // Reset category offer
        product.categoryOffer = 0;

        // Recalculate salePrice based on other active offers
        const maxOffer = Math.max(product.productOffer || 0, product.brandOffer || 0);

        if (maxOffer > 0) {
          product.salePrice = product.regularPrice * (1 - maxOffer / 100);
        } else {
          product.salePrice = product.regularPrice;
        }

        await product.save();
      }
    }

    // Step 4: Deactivate the Offer document (if any)
    await Offer.deleteMany(
      { type: "category", refId: category._id, isActive: true },
      { $set: { isActive: false } }
    );

    // Step 5: Respond to client
    res.json({ status: true, message: "Category offer removed successfully" });
  } catch (error) {
    console.error(error);
    res.status(Status.INTERNAL_ERROR).json({ status: false, message: "Internal Server Error" });
  }
};



const listCategory = async (req,res)=>{
    try {
        const {categoryId}=req.body;
        await Category.updateOne({_id:categoryId},{$set:{isDeleted:false}});
        res.json({success:true,message:"Category listed successfully"})
    } catch (error) {
        res.status(Status.INTERNAL_ERROR).json({success:false,message:"error listing the category"})
        console.log("listCategory error:",error);
    }
}


const unlistCategory = async (req,res)=>{
    try {
        const {categoryId}=req.body;
        await Category.updateOne({_id:categoryId},{$set:{isDeleted:true}});
        res.json({success:true,message:"Category unlisted successfully"})
    } catch (error) {
        res.status(Status.INTERNAL_ERROR).json({success:false,message:"error unlisting the category"})
        console.log("unlistCategory error:",error);
    }
}


module.exports={
    categoryInfo,
    loadAddCategoryPage,
    addCategory,
    loadEditCategory,
    editCategory,
    addCategoryOffer,
    removeCategoryOffer,
    listCategory,
    unlistCategory,
}