FROM node:20-bookworm

ENV DEBIAN_FRONTEND=noninteractive
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
ENV PATH=$PATH:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$ANDROID_SDK_ROOT/platform-tools

RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jdk unzip curl git wget ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN mkdir -p $ANDROID_SDK_ROOT/cmdline-tools \
 && cd /tmp \
 && curl -fsSL -o cmdline.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip \
 && unzip -q cmdline.zip -d $ANDROID_SDK_ROOT/cmdline-tools \
 && mv $ANDROID_SDK_ROOT/cmdline-tools/cmdline-tools $ANDROID_SDK_ROOT/cmdline-tools/latest \
 && rm cmdline.zip

RUN yes | sdkmanager --licenses > /dev/null 2>&1 || true \
 && sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0" > /dev/null

RUN npm install -g cordova

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
