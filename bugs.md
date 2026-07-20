# 💧 Smart Water Supply & Notification System — Bug Report

This document reports the security, compatibility, and logic bugs identified in the current smart water supply system codebase.

---

## 1. HTML Attribute Corruption & Broken Edit Button
* **File:** [public/dashboard.html](file:///C:/Dev_Sammie/Smart_water_supply/public/dashboard.html#L534-L537)
* **Severity:** High (Functional Blocker)
* **Description:** 
  The edit button in the water schedules table attempts to pass the stringified schedule object inline in the HTML `onclick` handler:
  ```html
  <button class="btn btn-outline btn-sm" onclick="editSchedule(${JSON.stringify(s).replace(/"/g,'&quot;')})">Edit</button>
  ```
  When the browser parses the HTML attribute, it decodes `&quot;` back to `"`. Since the `onclick` attribute itself is wrapped in double quotes (`onclick="..."`), the decoded quotes inside the JSON string prematurely terminate the attribute. The browser interprets the remainder of the JSON string as invalid HTML attributes (e.g. `id`, `zone_id`), causing a markup syntax crash. When the button is clicked, a JavaScript syntax error occurs, and the edit modal fails to open.
* **Impact:** Administrators cannot edit water schedules.
* **Recommended Fix:** 
  Store the schedules in a global array/map in JavaScript (e.g., `window.schedules = sch`) and pass only the array index or schedule ID to the click handler:
  ```html
  <button class="btn btn-outline btn-sm" onclick="editScheduleById(${s.id})">Edit</button>
  ```

---

## 2. Browser Compatibility Navigation Crash (`ReferenceError: event is not defined`)
* **File:** [public/dashboard.html](file:///C:/Dev_Sammie/Smart_water_supply/public/dashboard.html#L461-L466)
* **Severity:** Medium-High
* **Description:** 
  The `showPanel(name)` function references the global `event` variable:
  ```javascript
  event?.currentTarget?.classList?.add('active');
  ```
  `window.event` is a legacy, non-standard feature. In modern browsers such as Mozilla Firefox (and in strict environments), `event` is not available globally inside standard function calls. Clicking navigation links throws a `ReferenceError: event is not defined` and crashes the navigation script.
* **Impact:** Users on Firefox or strict browser configurations cannot switch between tabs on the dashboard.
* **Recommended Fix:** 
  Pass `this` or the active event explicitly from the `onclick` inline calls (e.g., `onclick="showPanel('schedules', event)"`), or update the active class by querying the navigation items by name or index.

---

## 3. Vulnerable and Buggy Manual SQL Parameter Replacement
* **File:** [database.js](file:///C:/Dev_Sammie/Smart_water_supply/database.js#L99-L120)
* **Severity:** High (Security & Stability)
* **Description:** 
  The custom `query` and `run` database wrappers manually replace the `?` character using a regular expression:
  ```javascript
  sql.replace(/\?/g, () => { ... })
  ```
  This custom interpolation has two major flaws:
  1. **Query Corruption:** If a query parameter or literal string inside the SQL statement naturally contains a `?` character (e.g., an email address or note field), it will be replaced by the regex.
  2. **SQL Injection:** It relies on custom single-quote escaping (`replace(/'/g, "''")`), which does not protect against all SQL injection vectors and is an anti-pattern.
* **Impact:** SQL queries containing question marks fail to run, and the system is vulnerable to SQL injection.
* **Recommended Fix:** 
  Use the native parameter binding supported by `sql.js` (e.g. passing parameters directly as the second argument to `db.exec` and `db.run`):
  ```javascript
  function query(sql, params = []) {
    const result = db.exec(sql, params);
    if (!result.length) return [];
    const { columns, values } = result[0];
    return values.map(row => Object.fromEntries(columns.map((col, i) => [col, row[i]])));
  }
  ```

---

## 4. Stored Cross-Site Scripting (XSS) Vulnerabilities
* **File:** [public/dashboard.html](file:///C:/Dev_Sammie/Smart_water_supply/public/dashboard.html#L609)
* **Severity:** Medium-High (Security)
* **Description:** 
  Several user-controlled properties are inserted directly into the DOM using template literals without being passed through the `esc()` sanitization helper. Specifically:
  - `u.zone` and `u.phone` inside `loadUsers()`
  - `a.target_zone` inside `loadAnnouncements()`
* **Impact:** 
  If a user signs up with a malicious script as their zone name or phone number, that script will execute in the browser of any admin viewing the Users list. Similarly, targeted announcements can run arbitrary script in users' browsers.
* **Recommended Fix:** 
  Wrap all user-supplied data in the `esc()` sanitizer helper:
  ```javascript
  <td>${esc(u.zone || '—')}</td>
  <td>${esc(u.phone || '—')}</td>
  ```

---

## 5. Unauthenticated API Limitations & Hardcoded Registration Dropdown
* **Files:** [public/index.html](file:///C:/Dev_Sammie/Smart_water_supply/public/index.html#L191), [server.js](file:///C:/Dev_Sammie/Smart_water_supply/server.js#L107)
* **Severity:** Medium
* **Description:** 
  The zone selection dropdown in the registration form is hardcoded to `Zone A` through `Zone D`. If an administrator adds or changes service zones in the database, new users cannot register for them. Meanwhile, the backend endpoint `/api/zones` requires JWT authentication, preventing guests on the signup page from loading the updated zone list.
* **Impact:** Admin-defined zone updates are not propagated to the signup page, and registration zone mapping remains static.
* **Recommended Fix:** 
  Expose a public endpoint for retrieving zone names (e.g., `/api/public/zones`) that does not require the `authMiddleware`, and dynamically fetch and populate the registration dropdown on load.

---

## 6. Datetime-Local Input Prefill Failures
* **File:** [public/dashboard.html](file:///C:/Dev_Sammie/Smart_water_supply/public/dashboard.html#L562)
* **Severity:** Medium
* **Description:** 
  When prefilling the start and end times in the Edit Schedule modal, the code slices the database string:
  ```javascript
  document.getElementById('sched-start').value = prefill.start_time?.slice(0,16);
  ```
  SQLite date functions store datetimes as `YYYY-MM-DD HH:MM:SS`. However, the HTML `<input type="datetime-local">` strictly expects a `T` separator (e.g., `YYYY-MM-DDTHH:MM`). Because the database date contains a space, the prefilled value fails to load in the input, leaving the start/end dates empty in the edit form.
* **Impact:** Administrators must re-select dates and times from scratch whenever editing an existing water schedule.
* **Recommended Fix:** 
  Convert spaces to `T` when formatting the datetime values:
  ```javascript
  document.getElementById('sched-start').value = prefill.start_time?.replace(' ', 'T').slice(0, 16);
  ```

---

## 7. Hardcoded Secrets in Source Code
* **File:** [server.js](file:///C:/Dev_Sammie/Smart_water_supply/server.js#L10)
* **Severity:** Low-Medium (Security)
* **Description:** 
  The secret key used for signing JWTs (`JWT_SECRET`) is hardcoded directly in the main server logic:
  ```javascript
  const JWT_SECRET = 'smart_water_secret_key_2024_change_in_production';
  ```
* **Impact:** Committing the code repository exposes the secret token, allowing attackers to forge session cookies.
* **Recommended Fix:** 
  Move `JWT_SECRET` and `PORT` into a `.env` file and load them using the native `process.env` or `dotenv` library.
