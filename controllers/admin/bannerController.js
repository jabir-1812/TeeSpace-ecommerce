import dotenv from "dotenv";
dotenv.config();
import Status from '../../constants/statusCodes.js'
import Banner from '../../models/bannerSchema.js'
import path from 'path';
import fs from 'fs'
import sharp from 'sharp';
import cloudinary from "../../config/cloudinary.js";


const getBannerPage=async (req,res)=>{
    try {
        const ITEMS_PER_PAGE=5;
        const page=parseInt(req.query.page) || 1;
        const search = req.query.search || '';

        const totalBanners=await Banner.countDocuments({title:{$regex:".*"+search+".*",$options:"i"}})
        const totalPages=Math.ceil(totalBanners/ITEMS_PER_PAGE);
        const banners=await Banner.find({title:{$regex:".*"+search+".*",$options:"i"}})
        .sort({createdAt:-1})
        .skip((page-1)*ITEMS_PER_PAGE)
        .limit(ITEMS_PER_PAGE)

        res.render('./admin/banner/2banner',{
            layout:"adminLayout",
            title:"Banner Management",
            banners,
            totalBanners,
            totalPages,
            search,
            currentPage:page
        })
    } catch (error) {
        console.log("error in getBannerPage:",error)
        res.redirect("/admin/page-error");
    }
}

const loadAddBannerPage=async (req,res)=>{
    try {
        res.render('./admin/banner/2add-banner',{
            layout:"adminLayout",
            title:"Add Banner"
        })
    } catch (error) {
        console.log("loadAddBannerPage error:",error);
        res.redirect("/admin/page-error");
    }
}

const addBanner=async (req,res)=>{
    try {
        const data=req.body;
        console.log("dataa",data)
        const image=req.file;
        console.log("banner image ==", image)

        let processedBuffer;
        try {
            processedBuffer = await sharp(req.file.buffer)
                .resize(500, 500, { fit: "cover" })  // ✅ crop center
                .toFormat("webp")                    // ✅ convert to webp
                .webp({ quality: 85 })               // ✅ compression
                .toBuffer();
        } catch (error) {
            console.error("Sharp Error:", error);
            return res.status(Status.INTERNAL_ERROR).json({
                success: false,
                message: "Image processing failed",
                error: error.message
            });
        }

        // ✅ Upload image to Cloudinary using buffer
        const uploadToCloudinary = () => {
            return new Promise((resolve, reject) => {
                const stream = cloudinary.uploader.upload_stream(
                    {
                    folder: "banners"   // ✅ your folder name
                    },
                    (error, result) => {
                    if (error) return reject(error);
                    resolve(result);
                    }
                );
                stream.end(processedBuffer);
            });
        };

        let uploadResult;
        try {
            uploadResult = await uploadToCloudinary();
        } catch (cloudError) {
            console.error("Cloudinary Upload Error:", cloudError);
            return res.status(Status.INTERNAL_ERROR).json({
            success: false,
            message: "Failed to upload image to Cloudinary",
            error: cloudError.message
            });
        }

        const newBanner=new Banner({
            cloudinaryId:uploadResult.public_id,
            image:uploadResult.secure_url,
            title:data.title,
            description:data.description,
            startDate:new Date(data.startDate+"T00:00:00"),
            endDate:new Date(data.endDate+"T00:00:00"),
            link:data.link
        }) 

        await newBanner.save().then((data)=>{console.log("success dataaa",data)});
        res.status(Status.OK).json({message:"Banner added successfully"});
    } catch (error) {
        console.log("addBanner() error:",error);
        res.redirect('/admin/page-error')
    }
}

const loadEditBannerPage=async (req,res)=>{
    try {
        const id=req.params.id;
        const banner=await Banner.findOne({_id:id});

        if(!banner) return res.redirect('/admin/page-error');
        res.render("./admin/banner/2edit-banner",{
            layout:"adminLayout",
            title:"Edit Banner",
            banner,
        })
    } catch (error) {
        console.log("loadEditBannerPage() error:",error);
        res.redirect('/admin/page-error')
    }
}


const editBanner = async (req,res)=>{
    try {
        const bannerId=req.params.id;
        const banner=await Banner.findById(bannerId)
        if(!banner) return res.status(404).json({message:"Banner not found"});
        // console.log(req.body);
        // console.log(req.file);
        const {title,description,startDate,endDate,link,removeOldImage}=req.body;
        banner.title=title;
        banner.description=description;
        banner.startDate=startDate;
        banner.endDate=endDate;
        banner.link=link;

        if(req.file){
            let processedBuffer;
            try {
                processedBuffer = await sharp(req.file.buffer)
                    .resize(500, 500, { fit: "cover" })  // ✅ crop center
                    .toFormat("webp")                    // ✅ convert to webp
                    .webp({ quality: 85 })               // ✅ compression
                    .toBuffer();
            } catch (error) {
                console.error("Sharp Error:", error);
                return res.status(Status.INTERNAL_ERROR).json({
                    success: false,
                    message: "Image processing failed",
                    error: error.message
                });
            }

             // 2️⃣ UPLOAD NEW IMAGE TO CLOUDINARY FIRST
            const uploadNewBanner = () => {
                return new Promise((resolve, reject) => {
                cloudinary.uploader.upload_stream(
                    { folder: "banners", format: "webp" },
                    (error, result) => {
                    if (error) return reject(error);
                    resolve(result);
                    }
                ).end(processedBuffer);
                });
            };

            let newImg;
            try {
                newImg = await uploadNewBanner();
            } catch (error) {
                console.log(error)

                return res.status(Status.INTERNAL_ERROR).json({
                success: false,
                message: "Failed to upload new banner to Cloudinary",
                error: error.message
                });
            }

            // 3️⃣ DELETE OLD IMAGE FROM CLOUDINARY (AFTER SUCCESS)
            try {
                await cloudinary.uploader.destroy(banner.cloudinaryId);
            } catch (err) {
                console.error("Old image delete failed:", err);
                // Not a critical failure, don't return error
            }

            banner.image = newImg.secure_url;
            banner.cloudinaryId = newImg.public_id;
        }

        await banner.save();
        return res.json({ success: true });
    } catch (error) {
        console.log('editBanner error:',error);
        return res.status(Status.INTERNAL_ERROR).json({ message: 'Internal Server Error' });
    }
}


const deleteBanner=async (req,res)=>{
    try {
        const id=req.query.id;
        await Banner.deleteOne({_id:id}).then((data)=>console.log(data));
        res.redirect('/admin/banners');
    } catch (error) {
        console.log("deleteBanner error:",error);
        res.redirect('/admin/page-error');
    }
}


export default {
    getBannerPage,
    loadAddBannerPage,
    addBanner,
    loadEditBannerPage,
    editBanner,
    deleteBanner
}