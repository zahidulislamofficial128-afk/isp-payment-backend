require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// সিকিউরিটি হেডার এবং পার্সিং
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: '*' })); // প্রোডাকশনে আপনার ডোমেন নির্দিষ্ট করুন

// হ্যাকিং/ডিডিওএস রিকোয়েস্ট রোধে রেট লিমিটার
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // ১৫ মিনিট
    max: 100 // প্রতি আইপি থেকে সর্বোচ্চ ১০০টি রিকোয়েস্ট
});
app.use(limiter);

// ডাটাবেজ মক হিসেবে ট্রানজেকশন ট্র্যাকিং (যাতে ডুপ্লিকেট পেমেন্ট ব্যবহার না হয়)
const processedTransactions = new Set();

// ১. পেমেন্ট লিংক তৈরি করার নিরাপদ এন্ডপয়েন্ট
app.post('/api/create-payment', async (req, res) => {
    try {
        const { name, amount, packageTitle } = req.body;

        if (!name || !amount) {
            return res.status(400).json({ error: "Name and Amount are required" });
        }

        const response = await axios.post(`${process.env.UDDOKTAPAY_BASE_URL}/checkout`, {
            full_name: name,
            email: "user@laksamnet.com",
            amount: amount,
            metadata: { packageTitle },
            redirect_url: "https://laksamnet.paymently.io/success",
            cancel_url: "https://laksamnet.paymently.io/cancel",
            webhook_url: `${process.env.BACKEND_PUBLIC_URL}/api/webhook`
        }, {
            headers: {
                'RT-UDDOKTAPAY-API-KEY': process.env.UDDOKTAPAY_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        res.json({ payment_url: response.data.payment_url });
    } catch (error) {
        console.error("Payment Creation Error:", error.response?.data || error.message);
        res.status(500).json({ error: "Failed to create payment" });
    }
});

// ২. UddoktaPay থেকে আসা পেমেন্ট রিসিভ করার সিকিউর Webhook
app.post('/api/webhook', async (req, res) => {
    try {
        const invoice_id = req.body.invoice_id;

        if (!invoice_id) {
            return res.status(400).send("Invalid Request");
        }

        // সিকিউরিটি ভেরিফিকেশন: সরাসরি গেটওয়ে থেকে পেমেন্ট স্ট্যাটাস ডাবল চেক করা
        const verifyResponse = await axios.post(`${process.env.UDDOKTAPAY_BASE_URL}/verify`, {
            invoice_id: invoice_id
        }, {
            headers: {
                'RT-UDDOKTAPAY-API-KEY': process.env.UDDOKTAPAY_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        const paymentData = verifyResponse.data;

        // ট্রানজেকশন আগেই প্রসেস করা হয়েছে কি না পরীক্ষা
        if (paymentData.status === 'COMPLETED') {
            if (processedTransactions.has(paymentData.transaction_id)) {
                return res.status(200).send("Transaction already processed");
            }

            // ট্রানজেকশন আইডি লক করা
            processedTransactions.add(paymentData.transaction_id);

            // ৩. Mock MikroTik Trigger (মাইক্রোটিক ছাড়াই অ্যাক্টিভেশন টেস্ট)
            await triggerMockMikrotikActivation(paymentData.full_name, paymentData.metadata?.packageTitle);

            return res.status(200).send("Payment Verified and User Activated");
        }

        res.status(400).send("Payment Not Completed");
    } catch (error) {
        console.error("Webhook Verification Failed:", error.message);
        res.status(500).send("Internal Server Error");
    }
});

// নক্‌ল/মক মাইক্রোটিক ফাংশন
async function triggerMockMikrotikActivation(username, packageName) {
    console.log("==========================================");
    console.log(`[MOCK MIKROTIK] Activating User...`);
    console.log(`[MOCK MIKROTIK] Username: ${username}`);
    console.log(`[MOCK MIKROTIK] Package: ${packageName}`);
    console.log(`[MOCK MIKROTIK] Status: ACTIVATED SUCCESSFUL ✅`);
    console.log("==========================================");
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running securely on port ${PORT}`));
