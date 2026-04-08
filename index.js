import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import mongoose from 'mongoose';
import { body, validationResult } from 'express-validator';
import dotenv from 'dotenv';

import twilio from 'twilio';
const { MessagingResponse } = twilio.twiml;

// 1. Session Tracker (In production, use Redis or a separate MongoDB collection)
const sessions = {};

// 2. The Questions Flow based on your Enquiry Schema
const registrationFlow = [
  { field: 'name', question: "Welcome to Car Loans! Let's get started. What is your **Full Name**?" },
  { field: 'phone', question: "Got it. What is your **Phone Number**?" },
  { field: 'city', question: "Which **City** do you live in?" },
  { field: 'employmentType', question: "What is your **Employment Type**? (e.g., Salaried, Self-Employed)" },
  { field: 'carBrand', question: "Which **Car Brand** are you interested in?" },
  { field: 'carName', question: "Which **Car Model** name?" },
  { field: 'carPrice', question: "What is the **Estimated Car Price**? (Numbers only)" },
  { field: 'loanAmount', question: "What is the **Required Loan Amount**? (Numbers only)" },
];


dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/car_loans';
mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB successfully'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Define Mongoose Schema and Model
const enquirySchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true },
  city: { type: String, required: true },
  employmentType: { type: String, required: true },
  carBrand: { type: String, required: true },
  carName: { type: String, required: true },
  carPrice: { type: Number, required: true },
  loanAmount: { type: Number, required: true },
  callbackTime: { type: String, default: '' },
  message: { type: String, default: '' },
  didContact: { type: Boolean, default: false } // Added for Admin
}, { timestamps: true });

const Enquiry = mongoose.model('Enquiry', enquirySchema);

const adminUserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true } // In a real app we'd hash this properly
});
const AdminUser = mongoose.model('AdminUser', adminUserSchema);



// POST /api/enquiries - Handle form submission
app.post(
  '/api/enquiries',
  [
    body('name').notEmpty().withMessage('Full Name is required'),
    body('phone').notEmpty().withMessage('Phone Number is required'),
    body('city').notEmpty().withMessage('City is required'),
    body('employmentType').notEmpty().withMessage('Employment Type is required'),
    body('carBrand').notEmpty().withMessage('Target Car Brand is required'),
    body('carName').notEmpty().withMessage('Target Car Name/Model is required'),
    body('carPrice').isNumeric().withMessage('Valid Estimated Car Price is required'),
    body('loanAmount').isNumeric().withMessage('Valid Required Loan Amount is required')
  ],
  async (req, res) => {
    // 1. Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
        message: 'Please correct the highlighted fields.'
      });
    }

    try {
      // 2. Process and save data to MongoDB
      const formData = req.body;
      const newEnquiry = new Enquiry({
        ...formData,
        carPrice: Number(formData.carPrice),
        loanAmount: Number(formData.loanAmount)
      });

      const savedEnquiry = await newEnquiry.save();

      // 3. Send success response
      res.status(201).json({
        success: true,
        message: 'Application submitted successfully! Our team will contact you shortly.',
        data: savedEnquiry
      });
    } catch (error) {
      console.error('Error saving enquiry to MongoDB:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error while saving application.'
      });
    }
  }
);


// ADMIN ROUTES (Basic unauthenticated for simplicity in this MVP)

// Login Admin
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = await AdminUser.findOne({ username });
    if (!admin || admin.password !== password) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    // We would typically send a JWT here, for simplicity we return success logic for the frontend
    res.json({ success: true, user: { username: admin.username, _id: admin._id } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get all admins
app.get('/api/admin/users', async (req, res) => {
  try {
    const admins = await AdminUser.find({}, '-password');
    res.json({ success: true, data: admins });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Create new admin
app.post('/api/admin/users', async (req, res) => {
    try {
      const { username, password } = req.body;
      const newAdmin = new AdminUser({ username, password });
      await newAdmin.save();
      res.status(201).json({ success: true, data: newAdmin });
    } catch (err) {
      res.status(400).json({ success: false, message: 'Failed to create user' });
    }
});
  
// Delete admin
app.delete('/api/admin/users/:id', async (req, res) => {
    try {
      await AdminUser.findByIdAndDelete(req.params.id);
      res.json({ success: true, message: 'User deleted' });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get all enquiries (Admin)
app.get('/api/admin/enquiries', async (req, res) => {
  try {
    const enquiries = await Enquiry.find().sort({ createdAt: -1 });
    res.json({ success: true, data: enquiries });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Update enquiry (e.g. didContact)
app.put('/api/admin/enquiries/:id', async (req, res) => {
  try {
    const { didContact } = req.body;
    const enquiry = await Enquiry.findByIdAndUpdate(req.params.id, { didContact }, { new: true });
    if (!enquiry) {
      return res.status(404).json({ success: false, message: 'Enquiry not found' });
    }
    res.json({ success: true, data: enquiry });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.delete('/api/admin/enquiries/:id', async (req, res) => {
    try {
        await Enquiry.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Enquiry deleted' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Dashboard Stats
app.get('/api/admin/dashboard-stats', async (req, res) => {
  try {
    const totalEnquiries = await Enquiry.countDocuments();
    const contacted = await Enquiry.countDocuments({ didContact: true });
    const uncontacted = await Enquiry.countDocuments({ didContact: false });
    
    // Monthly data for graph (last 6 months approximate)
    const monthlyData = await Enquiry.aggregate([
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
          total: { $sum: 1 },
          contacted: { $sum: { $cond: [{ $eq: ["$didContact", true] }, 1, 0] } }
        }
      },
      { $sort: { _id: 1 } },
      { $limit: 6 }
    ]);

    // Format for recharts
    const chartData = monthlyData.map(m => ({
      name: m._id,
      Total: m.total,
      Contacted: m.contacted
    }));

    res.json({
      success: true,
      data: {
        totalEnquiries,
        contacted,
        uncontacted,
        chartData
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/whatsapp', async (req, res) => {
  const twiml = new MessagingResponse();
  const from = req.body.From; // format: 'whatsapp:+123456789'
  const body = req.body.Body.trim();

  try {
    // If user says "hi" or "start", reset/start their session
    if (body.toLowerCase() === 'hi' || body.toLowerCase() === 'start') {
      sessions[from] = { step: 0, data: {} };
      twiml.message(registrationFlow[0].question);
      return res.type('text/xml').send(twiml.toString());
    }

    const session = sessions[from];

    if (!session) {
      twiml.message("Please say *Hi* to start your car loan application.");
      return res.type('text/xml').send(twiml.toString());
    }

    // Save the answer from the previous step
    const currentStepIndex = session.step;
    const fieldName = registrationFlow[currentStepIndex].field;
    session.data[fieldName] = body;

    // Move to next step
    const nextStepIndex = currentStepIndex + 1;

    if (nextStepIndex < registrationFlow.length) {
      session.step = nextStepIndex;
      twiml.message(registrationFlow[nextStepIndex].question);
    } else {
      // --- ALL DATA COLLECTED: SAVE TO MONGODB ---
      const newEnquiry = new Enquiry({
        ...session.data,
        carPrice: Number(session.data.carPrice) || 0,
        loanAmount: Number(session.data.loanAmount) || 0,
      });

      await newEnquiry.save();
      
      twiml.message("✅ Thank you! Your application has been submitted successfully. Our team will contact you shortly.");
      delete sessions[from]; // Clear session
    }

    res.type('text/xml').send(twiml.toString());
  } catch (error) {
    console.error("WhatsApp Error:", error);
    twiml.message("Sorry, something went wrong. Please try again later.");
    res.type('text/xml').send(twiml.toString());
  }
});

// Basic health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Server is running' });
});



app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
