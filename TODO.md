# 💧 Smart Water Supply & Notification System — TODO List

This document tracks planned fixes, enhancements, and upcoming feature developments for the Smart Water Supply system.

---

## 🛠️ Phase 1: Security & Stability (High Priority)

- [ ] **Secure Secret Management**: Move `JWT_SECRET` and `PORT` out of [server.js](file:///C:/Users/ADMIN/OneDrive/Documents/Smart_water_supply/server.js) and into a `.env` file using the `dotenv` library or Node.js native env loader.
- [ ] **Registration Verification**:
  - [ ] Implement password complexity requirements (minimum length is currently checked, but need uppercase/number checks).
  - [ ] Add email format validation and phone number sanitization.
- [ ] **Graceful Database Shutdowns**: Ensure that when the server terminates (e.g., `SIGINT`, `SIGTERM`), database changes are saved and the database connection is closed gracefully.

---

## 🗺️ Phase 2: Zone Management (CRUD Operations)

Currently, zones (Zone A, B, C, D) are pre-seeded and read-only.
- [ ] **Backend Endpoints**:
  - [ ] `POST /api/zones` — Create a new service zone.
  - [ ] `PUT /api/zones/:id` — Update zone name or description.
  - [ ] `DELETE /api/zones/:id` — Delete a zone (with validation to prevent deleting zones that have active users or schedules).
- [ ] **Admin Dashboard UI**:
  - [ ] Add a **"+ Add Zone"** button to the **Manage Zones** panel.
  - [ ] Include inline **Edit** and **Delete** actions for each zone.
  - [ ] Connect the dynamic zone dropdowns in standard user registration and schedule forms to pull automatically from the updated zones database.

---

## 📺 Phase 3: Dashboard & UX Enhancements

- [ ] **Live Water Status Banner (User View)**:
  - [ ] Update the dashboard banner logic to look for any schedule in the user's zone with `status === 'active'`.
  - [ ] If active, change the banner color to success green and display: *"💧 Water is currently running in your zone!"*
- [ ] **Schedules Search & Pagination**:
  - [ ] Add filter-by-zone dropdown for schedules.
  - [ ] Add pagination or infinite scroll for historical schedules.
- [ ] **Announcements Archive**:
  - [ ] Allow users to view expired announcements or search through past announcements.

---

## 📢 Phase 4: User Interaction & Notifications

- [ ] **User Complaints / Leak Reporting**:
  - [ ] Create a "Report Issue" panel for regular users to report burst pipes, leakages, or water theft.
  - [ ] Create an "Issues Queue" in the Admin panel to view, update, and resolve user-reported issues.
- [ ] **Profile Settings**:
  - [ ] Allow users to update their Profile details (Full Name, Phone, Zone) and change passwords securely.
- [ ] **Mock Notification System**:
  - [ ] Integrate a mock SMS/Email service that logs notification logs (or prints to terminal) when:
    - A new water schedule is created for a user's zone.
    - A schedule is cancelled.
    - An announcement is targeted to their zone.

---

## 🤖 Phase 5: Automation (Advanced)

- [ ] **Automatic Schedule Transitions**:
  - [ ] Implement a lightweight scheduler (like `node-cron` or standard interval loops) that checks schedules and automatically updates status:
    - From `scheduled` to `active` when current time matches or exceeds `start_time`.
    - From `active` to `completed` when current time exceeds `end_time`.
