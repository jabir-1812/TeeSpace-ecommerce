import express from 'express'
const router=express.Router();
import adminController from '../controllers/admin/adminController.js';
import auth from '../middlewares/auth.js';
const {adminAuth}=auth;
import customerController from '../controllers/admin/customerController.js';
import categoryController from '../controllers/admin/categoryController.js';
import brandController from '../controllers/admin/brandController.js';
import productController from '../controllers/admin/productController.js';
import bannerController from '../controllers/admin/bannerController.js';
import orderController from '../controllers/admin/adminOrderController.js';
import couponController from '../controllers/admin/couponController.js';
import salesReportController from '../controllers/admin/salesReportController.js';
import dashboardController from '../controllers/admin/dashboardController.js';
import multer from 'multer';
// import cloudinaryBanner from '../config/cloudinaryBanner.js';
// const {bannerStorage} = cloudinaryBanner;
// const bannerUploads = multer({storage:bannerStorage}) 

import upload from '../middlewares/multer.js'
import logger from '../config/logger.js'


//404
router.get('/page-error',adminController.pageError);


//Login
router.get('/login',adminController.loadLogin);
router.post('/login',adminController.login);
router.get('/logout',adminController.logout);





//dashboard
router.get('/',adminAuth,dashboardController.loadDashboard);
router.get('/dashboard/top-ten-products',adminAuth,dashboardController.getTopTenProducts);
router.get('/dashboard/top-ten-categories',adminAuth,dashboardController.getTopTenCategories)
router.get('/dashboard/top-ten-brands',adminAuth,dashboardController.getTopTenBrands)







//Customer Management
router.get('/users',adminAuth,customerController.customerInfo);
router.post('/block-customer',adminAuth,customerController.blockCustomer);
router.post('/unblock-customer',adminAuth,customerController.unblockCustomer);



//Category Management
router.get('/category',adminAuth,categoryController.categoryInfo)
router.get('/add-category',adminAuth,categoryController.loadAddCategoryPage);
router.post('/add-category',adminAuth,categoryController.addCategory);
router.get('/edit-category/:id',adminAuth,categoryController.loadEditCategory);
router.post('/edit-category/:id',adminAuth,categoryController.editCategory);
router.post('/add-category-offer',adminAuth,categoryController.addCategoryOffer)
router.post('/remove-category-offer',adminAuth,categoryController.removeCategoryOffer);
router.post('/list-category',adminAuth,categoryController.listCategory);
router.post('/unlist-category',adminAuth,categoryController.unlistCategory);



//Brand Management
router.get('/brands',adminAuth,brandController.loadAllBrands);
router.get('/add-brand',adminAuth,brandController.loadAddBrandPage);
router.post('/add-brand',adminAuth,upload.single("brandLogo"),brandController.addBrand);
router.post('/add-brand-offer',adminAuth,brandController.addBrandOffer);
router.post('/remove-brand-offer',adminAuth,brandController.removeBrandOffer);
router.get('/edit-brand/:id',adminAuth,brandController.loadEditBrand);
router.post('/edit-brand/:id',adminAuth,upload.single("brandLogo"),brandController.editBrand);
router.post('/block-brand',adminAuth,brandController.blockBrand);
router.post('/unblock-brand',adminAuth,brandController.unblockBrand);
// router.get('/delete-brand',adminAuth,brandController.deleteBrand);



//Product Management
router.get('/add-products',adminAuth,productController.loadAddProductPage);
router.post('/add-products',adminAuth,upload.array('images',4),productController.addProduct);
router.get('/products',adminAuth,productController.loadAllProductsPage);
router.post('/add-product-offer',adminAuth,productController.addProductOffer);
router.post('/remove-product-offer',adminAuth,productController.removeProductOffer);
router.post('/block-unblock-product/:id',adminAuth,productController.blockUnblockProduct);
router.post('/block-product',adminAuth,productController.blockProduct);
router.post('/unblock-product',adminAuth,productController.unblockProduct);
router.get('/edit-product/:id',adminAuth,productController.loadEditProductPage);
router.post('/edit-product/:id',adminAuth,upload.array('newImages'),productController.editProduct);



//Banner Management
router.get('/banners',adminAuth,bannerController.getBannerPage);
router.get('/add-banner',adminAuth,bannerController.loadAddBannerPage);
router.post('/add-banner',adminAuth,upload.single('image'),bannerController.addBanner);
router.get('/edit-banner/:id',adminAuth,bannerController.loadEditBannerPage);
router.post('/edit-banner/:id',adminAuth,upload.single('image'),bannerController.editBanner);
router.get('/delete-banner',adminAuth,bannerController.deleteBanner)



//order management
router.get('/orders',adminAuth,orderController.listAllOrders)
router.get('/orders/order-details/:orderId',adminAuth,orderController.getOrderDetails)
router.post('/orders/order-details/update-item-status',adminAuth,orderController.updateItemStatus)
router.patch('/orders/:orderId/return/:itemId/:action',adminAuth,orderController.manageReturnRequest)
router.patch('/orders/return/update-status',adminAuth,orderController.updateReturnStatus);



//coupon management
router.get('/coupons',adminAuth,couponController.getCouponsPage);
router.get("/coupons/add-new-coupon",adminAuth,couponController.getAddNewCouponPage)
router.post('/coupons/add-new-coupon',adminAuth,couponController.addNewCoupon)
router.get('/coupons/edit-coupon/:couponId',adminAuth,couponController.getEditCouponPage)
router.put('/coupons/edit-coupon/:couponId',adminAuth,couponController.editCoupon)
router.delete('/coupons/delete-coupon/:couponId',adminAuth,couponController.deleteCoupon)
router.put('/coupons/de-activate/:couponId',adminAuth,couponController.deActivateCoupon)
router.put('/coupons/activate/:couponId',adminAuth,couponController.activateCoupon)


//sales report
router.get('/sales-report-page',adminAuth,salesReportController.getSalesReportPage)
router.get('/sales-report',adminAuth,salesReportController.getSalesReport)
router.get('/sales-report/download/pdf',adminAuth,salesReportController.getSalesReportPDF)
router.get('/sales-report/download/excel',adminAuth,salesReportController.getSalesReportExcel)


export default router