from PIL import Image, ImageDraw
import os

os.makedirs('static/icons', exist_ok=True)
img = Image.new('RGBA', (128, 128), (30, 35, 51, 255))
draw = ImageDraw.Draw(img)
draw.rounded_rectangle([14, 38, 114, 90], radius=20, fill=(60, 65, 90, 255))
draw.ellipse([22, 55, 38, 71], fill=(108, 99, 255, 255))
draw.ellipse([75, 52, 91, 68], fill=(108, 99, 255, 180))
draw.ellipse([86, 58, 102, 74], fill=(108, 99, 255, 180))
draw.ellipse([80, 46, 96, 62], fill=(108, 99, 255, 180))
draw.rectangle([45, 54, 55, 72], fill=(140, 130, 255, 255))
draw.rectangle([38, 61, 62, 65], fill=(140, 130, 255, 255))
img.save('static/icons/default.png')
print('Default icon created')
