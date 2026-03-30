from app import app, db
from models import AIModel

with app.app_context():
    db.create_all()
    print("Database schema updated successfully.")
