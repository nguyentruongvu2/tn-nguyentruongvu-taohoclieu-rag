import sqlite3
import os
import sys

db_path = '/app/uploads/rag_auth.db'

# Check if file exists
if not os.path.exists(db_path):
    print(f"Error: db file not found at {db_path}")
    sys.exit(1)

# Import security AFTER checking path, because it depends on the environment
from app.security import hash_password

conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
new_password = 'admin123'
hashed = hash_password(new_password)
cursor = conn.cursor()
cursor.execute("SELECT * FROM users WHERE role = 'admin'")
admins = cursor.fetchall()
if admins:
    for admin in admins:
        cursor.execute("UPDATE users SET password_hash = ?, is_active = 1, failed_login_attempts = 0, locked_until = NULL WHERE id = ?", (hashed, admin['id']))
        print("Reset admin password for " + admin['email'])
else:
    print("No admin user found")
conn.commit()
conn.close()
