# Postman Collection Setup Guide

This directory contains the complete Postman collection and environment for testing all Lavellh API endpoints.

## 📋 Files

1. **Lavellh-API.postman_collection.json** - Complete API collection with all endpoints
2. **Lavellh-Environment.postman_environment.json** - Environment variables configuration

## 🚀 Installation Steps

### Step 1: Import Collection into Postman

1. Open **Postman** application
2. Click **Import** button (top-left)
3. Choose **Upload Files**
4. Select **Lavellh-API.postman_collection.json**
5. Click **Import**

### Step 2: Import Environment

1. Click the **Settings icon** ⚙️ (top-right)
2. Select **Environments**
3. Click **Import** button
4. Select **Lavellh-Environment.postman_environment.json**
5. Click **Import**

### Step 3: Activate Environment

1. In the top-right, find the **Environment dropdown**
2. Select **Lavellh - Development**
3. Verify it shows the environment name

## 📝 Environment Variables

The environment includes these variables:

| Variable | Purpose | Initial Value |
|----------|---------|----------------|
| `base_url` | API server URL | `http://localhost:5000` |
| `access_token` | User JWT token | Empty (set after login) |
| `bo_access_token` | Business Owner JWT token | Empty (set after login) |
| `admin_token` | Admin JWT token | Empty (set after login) |
| `employee_id` | Current employee ID | Empty (set from response) |
| `service_id` | Current service ID | Empty (set from response) |
| `booking_id` | Current booking ID | Empty (set from response) |
| `appointment_id` | Current appointment ID | Empty (set from response) |
| `category_id` | Current category ID | Empty (set from response) |
| `provider_id` | Current provider ID | Empty (set from response) |
| `conversation_id` | Current conversation ID | Empty (set from response) |
| `notification_id` | Current notification ID | Empty (set from response) |

## 🔑 Authentication Flow

### User Authentication

1. Open **Authentication → User Register**
   - Fill in the request body with user details
   - Click **Send**
   - Save the `access_token` from response

2. Set the token as variable:
   - Copy token from response
   - Go to **Environments → Lavellh - Development**
   - Paste token in `access_token` field
   - Click **Save**

### Business Owner Authentication

1. Open **Business Owner → Login Business Owner**
   - Use business owner email and password
   - Click **Send**
   - Copy the returned `accessToken`

2. Set the variable:
   - Go to **Environments → Lavellh - Development**
   - Paste token in `bo_access_token` field
   - Click **Save**

### Admin Authentication

1. Open **Admin → Admin Login**
   - Use admin credentials
   - Click **Send**
   - Copy the token

2. Set the variable:
   - Go to **Environments → Lavellh - Development**
   - Paste token in `admin_token` field
   - Click **Save**

## 📚 API Endpoints Organization

### **Authentication**
- User Register
- User Login
- User Logout
- Forgot Password
- Verify OTP
- Reset Password
- Refresh Token

### **Business Owner**
- Register Business Owner
- Login Business Owner
- Get/Update Profile
- Get/Create Business Profile
- Get Stats, Activities, Notifications

### **Employees**
- Create Employee with Service
- Get All Employees
- Search Employees
- Get Employee Details
- Update/Delete Employee
- Get/Add/Update/Delete Employee Services

### **Services**
- Create Service (with optional employee)
- Get All Services (Public)
- Get Service Details (Public)

### **Bookings**
- Create Booking
- Get My Bookings
- Get Booking Details
- Cancel Booking
- Business Owner Operations (Accept, Complete, etc.)

### **Appointments**
- Create Appointment
- Get My Appointments
- Get Appointment Details
- Cancel Appointment
- Business Owner Operations (Accept, Complete, etc.)

### **Categories**
- Get All Categories
- Get Category Details

### **Wishlist**
- Add to Wishlist
- Get My Wishlist
- Remove from Wishlist

### **Conversations & Messages**
- Get All Conversations
- Get Conversation Messages
- Send Message (Socket.io)

### **Notifications**
- Get Notifications
- Mark as Read
- Delete Notification

### **Admin**
- Admin Login
- Get All Users
- Get All Providers
- Get Verification Requests
- Approve/Reject Provider

### **Payments**
- Get Payment Keys
- Pay Down Payment
- Pay Remaining Amount

## 💡 Usage Tips

### Auto-populate Variables from Response

1. After login, the response contains a token
2. Instead of manually copying, use **Tests** tab:

```javascript
// Add this to Tests tab of login request
if (pm.response.code === 200) {
  var jsonData = pm.response.json();
  pm.environment.set("access_token", jsonData.accessToken);
  pm.environment.set("bo_access_token", jsonData.accessToken);
}
```

3. After running the request, variables auto-update

### Extract IDs from Responses

For any request that returns an ID (employee, service, booking), use:

```javascript
// In Tests tab
if (pm.response.code === 201 || pm.response.code === 200) {
  var jsonData = pm.response.json();
  if (jsonData.data && jsonData.data._id) {
    pm.environment.set("employee_id", jsonData.data._id);
  }
}
```

### Change Base URL

To change the server URL:

1. Click **Environments** (top-right)
2. Select **Lavellh - Development**
3. Change `base_url` value
4. Click **Save**

All requests automatically use the new URL.

## 🧪 Testing Workflow

### User Workflow
1. Register User → Save token
2. Create Booking → Save booking_id
3. Pay Down Payment
4. View My Bookings
5. Message Provider (Socket.io)

### Business Owner Workflow
1. Register Business Owner → Save token
2. Create Employee → Save employee_id
3. Create Service → Save service_id
4. Get All Bookings
5. Accept Booking
6. Complete Booking

### Admin Workflow
1. Login Admin → Save token
2. Get All Providers
3. Get Verification Requests
4. Approve/Reject Provider

## 🔗 WebSocket (Socket.io) Testing

The collection includes Socket.io endpoints. For real-time testing:

1. Use a Socket.io client or Postman Web Socket support
2. Connect to: `ws://localhost:5000`
3. Send events like `message:send`, `conversation:join`
4. Use the token for authentication

## 🐛 Troubleshooting

### 401 Unauthorized
- Token has expired → Re-login to get new token
- Token not set in environment → Check environment variables
- Token format wrong → Should be `Bearer <token>`

### 403 Forbidden
- Not a business owner → Use `bo_access_token` for BO endpoints
- Not an admin → Use `admin_token` for admin endpoints

### 404 Not Found
- ID doesn't exist → Check if `employee_id`, `service_id` etc. are set correctly
- Wrong URL → Verify endpoint path matches collection

### 400 Bad Request
- Missing required fields → Check request body/form data
- Wrong data format → JSON arrays should be proper JSON (not strings)
- File upload issues → Ensure file is selected in form-data

## 📖 Additional Resources

- **API Docs**: Check the README.md in the project root
- **Models**: See [src/models](../src/models) for data structure
- **Routes**: See [src/routes](../src/routes) for all endpoints
- **Middleware**: Authentication uses JWT tokens

## ✅ Quick Checklist

- [ ] Imported Lavellh-API.postman_collection.json
- [ ] Imported Lavellh-Environment.postman_environment.json
- [ ] Set environment to "Lavellh - Development"
- [ ] base_url is set to your server (http://localhost:5000)
- [ ] Logged in as user/business owner/admin
- [ ] Tokens are saved in environment

---

**Happy Testing! 🚀**
