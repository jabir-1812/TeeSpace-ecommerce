# E-Commerce Web Application

A full‑featured **e‑commerce web application** built using **Node.js**, **Express**, **MongoDB**, and **EJS**. The project supports both **user-side shopping features** and a complete **admin panel** for managing the platform.

---

## 🚀 Tech Stack

* **Backend:** Node.js, Express.js
* **Frontend:** EJS, HTML, CSS, Bootstrap
* **Database:** MongoDB (Mongoose)
* **Authentication:** Session-based auth, Google OAuth
* **Payments:** Razorpay
* **Charts & Reports:** Admin dashboard charts

---

## 👤 User Features

* User registration & login (Manual + Google OAuth)
* Secure user authentication
* Home page with **new arrivals**
* Product listing & product details
* Cart management
* Wishlist
* User wallet
* Manage multiple delivery addresses
* Referral system with rewards
* Coupons & offers
* Secure online payments using **Razorpay**
* Order placement & order history
* Order return feature

---

## 🛠️ Admin Features

* Admin authentication
* User management (block / unblock users)
* Dashboard with charts & analytics
* Order management
* Product management
* Category management
* Brand management
* Coupon management
* Sales report generation

---

## 📁 Project Structure (Simplified)

```
project-root/
│
├── controllers/
├── services/
├── models/
├── routes/
├── views/          # EJS templates
├── public/         # CSS, JS, images
├── config/
├── middleware/
├── README.md
├── package.json
└── app.js
```

---

## ⚙️ Environment Variables

Create a `.env` file using `.env.example` and add your own values.

```
PORT=3000
MONGO_URI=your_mongodb_connection_string
SESSION_SECRET=your_session_secret
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
NODEMAILER_PASSWORD=your_nodemailer_password
NODEMAILER_EMAIL=your_nodemailer_email
CLOUDINARY_NAME=your_cloudinary_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret

```

---

## ▶️ How to Run the Project Locally

1. Clone the repository

```bash
git clone https://github.com/jabir-1812/nodewebapp.git
```

2. Install dependencies

```bash
npm install
```

3. Start the server

```bash
npm start
```

4. Open in browser

```
http://localhost:3000
```

---

## 📌 Notes

* This project is built for **learning and portfolio purposes**
* Razorpay is used in test mode
* Admin routes are protected

---

## 📄 License

This project is for educational use.

---

## 🙌 Author

Developed by **Jabir C**
