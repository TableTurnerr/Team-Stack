# Tesseract Data Files

This folder should contain Tesseract OCR trained data files.

## Required File

Download `eng.traineddata` from:
https://github.com/tesseract-ocr/tessdata/blob/main/eng.traineddata

Place it in this folder so the path is:
```
Resources/tessdata/eng.traineddata
```

## Note

The file is ~4MB and is not included in the repository.
The application will fail to initialize OCR without this file.
