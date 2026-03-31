from PIL import Image
import os

def convert_png_to_ico(png_path, ico_path):
    try:
        img = Image.open(png_path)
        # Resize if necessary or just save as ico
        # Standard icon sizes: 16, 32, 48, 64, 128, 256
        img.save(ico_path, format='ICO', sizes=[(16,16), (32,32), (48,48), (64,64), (128,128), (256,256)])
        print(f"Successfully converted {png_path} to {ico_path}")
    except Exception as e:
        print(f"Error converting icon: {str(e)}")

if __name__ == "__main__":
    # Path to the logo I just generated
    logo_png = r"C:\Users\35866\.gemini\antigravity\brain\acd8bb45-a6fa-42c2-9f61-2dbb03004b79\nexus_logo_refined_1774871455757.png"
    logo_ico = r"c:\Users\35866\Documents\trae_projects\Nexus\nexus.ico"
    convert_png_to_ico(logo_png, logo_ico)
