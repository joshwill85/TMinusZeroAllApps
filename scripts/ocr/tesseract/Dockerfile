FROM alpine:3.19

RUN apk add --no-cache \
  tesseract-ocr \
  tesseract-ocr-data-eng

WORKDIR /data

ENTRYPOINT ["tesseract"]
