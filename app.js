const express=require('express');
const app=express();
const path=require('path');
require('dotenv').config();
const passport=require('./config/passport')
const db=require('./config/db');
const userRouter=require('./routes/userRouter');
const adminRouter=require('./routes/adminRouter');
const expressLayout=require('express-ejs-layouts')
const session=require('express-session');
const nocache=require('nocache')
const morgan=require('morgan')
const logger=require('./config/logger')
const STATUS_CODES=require('./constants/statusCodes');
const {invalidRoute}=require('./middlewares/invalidRoute')


db();

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


// app.use((req, res) => {
//   res.render('invalid-route',{
//     title:"Invalid Route"
//   })
// });

app.use(invalidRoute)

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(STATUS_CODES.INTERNAL_ERROR).render('error-page', { title: "Server Error" });
});


app.listen(process.env.PORT,(err)=>{
    if(err){
        console.log("error starting server:",err)
    }else{
        console.log(`Server is running at : http://localhost:${process.env.PORT}`);
    }
})
