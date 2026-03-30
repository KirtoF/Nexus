import requests
try:
    res = requests.get('http://127.0.0.1:5000/api/servers')
    print(res.json())
except Exception as e:
    print(f"Error: {e}")
