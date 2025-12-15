import dotenv from "dotenv";
dotenv.config();
import express from 'express';
const app=express();
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {passport} from './config/passport.js';
import connectDB from './config/db.js';
import userRouter from './routes/userRouter.js';
import adminRouter from './routes/adminRouter.js';
import expressLayout from 'express-ejs-layouts';
import session from 'express-session';
import nocache from 'nocache';
import morgan from 'morgan';
import logger from './config/logger.js';
import STATUS_CODES from './constants/statusCodes.js';
import invalidRoute from './middlewares/invalidRoute.js';
import errorHandler from './middlewares/errorHandling.js';



connectDB();

// create a stream object for Morgan to use Winston
const stream = {
  write: (message) => logger.info(message.trim()) // remove extra newline
};

// use Morgan with Winston (morgan middleware first)
// app.use(morgan('combined', { stream }));
// app.use(morgan('tiny', { stream }));
const shortFormat = ':method :url :status :response-time ms';
app.use(morgan(shortFormat, { stream }));


app.use(expressLayout);
app.use(express.json());
app.use(express.urlencoded({extended:true}));

app.use(nocache());
app.use(session({
    secret:process.env.SESSION_SECRET,
    resave:false,
    saveUninitialized:true,
    cookie:{
        secure:false,
        httpOnly:true,
        maxAge:72*60*60*1000
    }
}))

app.use(passport.initialize());// Start Passport or using passport log in & out features 
app.use(passport.session());// Let Passport store user in session (stay logged in)



app.set('view engine','ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layout'); // default layout file: views/layout.ejs
app.use(express.static('public'));



app.use('/',userRouter);
app.use('/admin',adminRouter);


app.use(invalidRoute)
app.use(errorHandler)


app.listen(process.env.PORT,(err)=>{
    if(err){
        console.log("error starting server:",err)
    }else{
        console.log(`Server is running at : http://localhost:${process.env.PORT}`);
    }
})

