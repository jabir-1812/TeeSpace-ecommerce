import Status from '../../constants/statusCodes.js'
import Banner from '../../models/bannerSchema.js'
import path from 'path';
import fs from 'fs'


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

        const newBanner=new Banner({
            image:image.filename,
            title:data.title,
            description:data.description,
            startDate:new Date(data.startDate+"T00:00:00"),
            endDate:new Date(data.endDate+"T00:00:00"),
            link:data.link
        }) 

        await newBanner.save().then((data)=>{console.log("success dataaa",data)});
        res.status(Status.OK).json({message:"Banner added successfully"});
        // res.redirect('/admin/banners')
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

        if(removeOldImage==='true' && req.file){
            if(banner.image && fs.existsSync(`public/uploads/resized-images/${banner.image}`)){
                console.log("if case worked unlinkkkkkkkkkkkkkkkkkkk")
                fs.unlinkSync(`public/uploads/resized-images/${banner.image}`);
            }
            banner.image=req.file.filename;
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