# 💧 Smart Water Supply & Notification System

A web-based platform designed to coordinate local water distribution schedules, manage service zones, and broadcast targeted announcements. This system provides a transparent portal for citizens to view upcoming water supply schedules and receives alerts from administrators.

---

## 🌟 Key Features

### 👤 For Residents
* **Personalized Dashboard**: Displays targeted information specific to the user's registered zone.
* **Upcoming Water Supplies**: View scheduled date/time slots when water is expected in the zone.
* **Zone-Targeted Announcements**: Receive relevant notices, emergency shutoff updates, or maintenance announcements.

### 🔑 For Administrators
* **Analytics Reports**: View real-time user statistics, total schedules, and distribution across all zones.
* **Water Schedule Manager**: Complete CRUD panel (Create, Read, Update, Delete) to schedule supply timings.
* **Announcements Portal**: Create and broadcast bulletins targeted at all zones or selected neighborhoods.
* **User directory**: Access details and contact information of all registered residents.

---

## 🛠️ Technology Stack

* **Backend**: Node.js, Express.js
* **Database**: SQLite database powered by [sql.js](https://sql.js.org/) (a WebAssembly-based SQLite wrapper)
* **Authentication**: Cookie-based JWT (JsonWebToken) session management & `bcryptjs` password hashing
* **Frontend**: Vanilla HTML5, CSS Custom Properties (Variables), and Client-side Javascript

---

## 🚀 Getting Started

### 📋 Prerequisites
Ensure you have [Node.js](https://nodejs.org/) (version 16+) or [Bun](https://bun.sh/) installed.

### 🔧 Installation

1. Clone or download this project to your local directory:
   ```bash
   git clone <repository-url>
   cd Smart_water_supply
   ```

2. Install the project dependencies:
   ```bash
   npm install
   # OR if using Bun
   bun install
   ```

### 🏃 Running the Application

1. Start the server:
   ```bash
   npm start
   # OR run server.js directly
   node server.js
   # OR if using Bun
   bun server.js
   ```

2. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

### 👤 Default Administrator Credentials
For testing admin controls, use the default seeded account details:
* **Email**: `admin@waterboard.com`
* **Password**: `Admin@1234`

---

## 📁 Project Structure

```
├── public/                 # Static frontend files
│   ├── index.html          # Sign-In / Create Account portal
│   └── dashboard.html      # Dynamic User/Admin workspace dashboard
├── database.js             # SQLite (sql.js) setup, schemas, and seeds
├── server.js               # Express application routes and server logic
├── package.json            # Node.js dependencies configuration
├── TODO.md                 # Project roadmap and upcoming enhancements
└── README.md               # Project overview and run guides
```

---

## 🗺️ Roadmap & Future Enhancements
To see upcoming builds, safety fixes, and automation improvements, please check our [TODO.md](file:///C:/Users/ADMIN/OneDrive/Documents/Smart_water_supply/TODO.md).
