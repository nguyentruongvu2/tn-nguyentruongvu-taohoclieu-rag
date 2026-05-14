import sqlite3
import os
import sys

# add app to path so we can import security
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))
from app.security import hash_password

db_path = os.path.join(os.path.dirname(__file__), "../uploads/rag_auth.db")
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row

new_password = "admin123"
hashed = hash_password(new_password)

cursor = conn.cursor()
cursor.execute("SELECT * FROM users WHERE role = 'admin'")
admins = cursor.fetchall()

if not admins:
    print("No admin user found. Creating one...")
    cursor.execute(
        "INSERT INTO users (username, email, password_hash, role, status, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
        ("admin", "admin@local.test", hashed, "admin", "active", 1)
    )
else:
    for admin in admins:
        print(f"Updating password for admin user: {admin['email']} (ID: {admin['id']})")
        cursor.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hashed, admin['id']))
        # Unlock account if it was locked
        cursor.execute("UPDATE users SET is_active = 1, failed_login_attempts = 0, locked_until = NULL WHERE id = ?", (admin['id'],))

conn.commit()
conn.close()
print("Admin password reset successfully to: admin123")
