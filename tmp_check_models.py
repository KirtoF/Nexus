from app import app, db, AIModel
with app.app_context():
    models = AIModel.query.all()
    for m in models:
        print(f"ID: {m.id}, Name: {m.name}, Provider: {m.provider}, Active: {m.is_active}")
