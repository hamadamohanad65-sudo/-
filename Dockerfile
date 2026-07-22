FROM node:20-slim

# sharp و jimp محتاجين شوية مكتبات نظام عشان يشتغلوا صح، وبنعمل المجلدات
# المطلوبة في نفس الأمر عشان نقلل عدد مراحل البناء (SnapDeploy بيحد عدد
# أوامر RUN المسموحة على الحاويات الصغيرة)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/auth_info /app/downloads /app/chat/data

WORKDIR /app

# ننسخ package.json الأول عشان الكاش يبقى فعّال، وبعدين نتبت الباكدجات
# وننسخ باقي المشروع كله جوه نفس الأمر (كل الملفات والمجلدات زي chat/,
# assets/, إلخ بتتنسخ هنا، ده بيمنع مشكلة "Cannot find module" لو ملف
# كان ناقص)
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

EXPOSE 8080

CMD ["npm", "start"]
