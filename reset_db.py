from app import app, db
from models import Server, AuditLog, Script, FileTask, Document
import os

db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'nexus.db')
if os.path.exists(db_path):
    os.remove(db_path)
    print(f"Removed old database at {db_path}")

with app.app_context():
    db.create_all()
    print("Database tables recreated successfully with new schema.")
