import os
import json
import requests
import math
from urllib.parse import urlparse, parse_qs
from http.server import BaseHTTPRequestHandler
from datetime import datetime
import dropbox
from PIL import Image
from PIL.ExifTags import TAGS, GPSTAGS
from io import BytesIO

# Use Vercel Environment Variables for security
DROPBOX_TOKEN = os.environ.get('DROPBOX_TOKEN')
NOTION_TOKEN = os.environ.get('NOTION_TOKEN')
NOTION_DB_ID = os.environ.get('NOTION_DB_ID')

def get_decimal_coordinates(info):
    """Converts EXIF GPS data into clean decimal format."""
    try:
        def convert_to_degrees(value):
            d, m, s = value
            return float(d) + (float(m) / 60.0) + (float(s) / 3600.0)
        
        lat = convert_to_degrees(info['GPSLatitude'])
        lon = convert_to_degrees(info['GPSLongitude'])
        
        if info['GPSLatitudeRef'] != 'N': lat = -lat
        if info['GPSLongitudeRef'] != 'E': lon = -lon
        return lat, lon
    except KeyError:
        return None, None

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        """
        Handles the Dropbox Webhook Verification Challenge.
        Dropbox sends a GET request with a 'challenge' string that we must echo back.
        """
        query_components = parse_qs(urlparse(self.path).query)
        if 'challenge' in query_components:
            challenge = query_components['challenge'][0]
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(challenge.encode('utf-8'))
            return
            
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"Dropbox Webhook Endpoint Ready")

    def do_POST(self):
        """Processes the actual background webhook trigger from Dropbox."""
        if not DROPBOX_TOKEN or not NOTION_TOKEN:
            self.send_error(500, "Missing Environment Variables")
            return

        dbx = dropbox.Dropbox(DROPBOX_TOKEN)
        notion_headers = {
            "Authorization": f"Bearer {NOTION_TOKEN}",
            "Content-Type": "application/json",
            "Notion-Version": "2022-06-28" # Core API version
        }
        
        try:
            # 1. Pull the newest photos from the specific Dropbox App Folder
            results = dbx.files_list_folder('')
            photos = []
            
            for entry in results.entries:
                if isinstance(entry, dropbox.files.FileMetadata) and entry.name.lower().endswith(('.jpg', '.jpeg', '.png')):
                    _, res = dbx.files_download(entry.path_lower)
                    file_bytes = res.content
                    
                    # 2. Extract EXIF Data using Pillow
                    img = Image.open(BytesIO(file_bytes))
                    exif_data = img._getexif() or {}
                    
                    exif = {TAGS.get(k, k): v for k, v in exif_data.items()}
                    gps_info = {}
                    if 'GPSInfo' in exif:
                        gps_info = {GPSTAGS.get(t, t): exif['GPSInfo'][t] for t in exif['GPSInfo']}
                    
                    lat, lon = get_decimal_coordinates(gps_info)
                    date_taken = exif.get('DateTimeOriginal', entry.client_modified.isoformat())
                    
                    photos.append({
                        "name": entry.name,
                        "bytes": file_bytes,
                        "date": str(date_taken),
                        "lat": lat,
                        "lon": lon,
                        "path": entry.path_lower
                    })
            
            if not photos:
                self.send_response(200)
                self.end_headers()
                return

            # Sort and build your clusters here using the Anchor Logic we wrote earlier
            # (Skipped in this snippet for brevity, assume photos are sorted into `clusters`)
            clusters = [photos] # Simplified placeholder
            
            for cluster in clusters:
                children_blocks = []
                
                for photo in cluster:
                    # 3. DIRECT NOTION UPLOAD PIPELINE
                    
                    # A: Create the upload object
                    create_payload = {
                        "mode": "single_part",
                        "filename": photo["name"],
                        "content_type": "image/jpeg"
                    }
                    create_headers = {**notion_headers, "Notion-Version": "2026-03-11"} # File API requires newer version header
                    upload_res = requests.post("https://api.notion.com/v1/file_uploads", headers=create_headers, json=create_payload)
                    upload_id = upload_res.json().get("id")
                    
                    # B: Send the raw file bytes via multipart/form-data
                    send_headers = {"Authorization": f"Bearer {NOTION_TOKEN}"}
                    requests.post(
                        f"https://api.notion.com/v1/file_uploads/{upload_id}/send", 
                        headers=send_headers,
                        files={"file": (photo["name"], photo["bytes"], "image/jpeg")}
                    )
                    
                    # C: Complete the upload
                    requests.post(f"https://api.notion.com/v1/file_uploads/{upload_id}/complete", headers=create_headers)
                    
                    # D: Append to our Notion Page block list using the new file_upload ID
                    children_blocks.append({
                        "object": "block",
                        "type": "image",
                        "image": {
                            "type": "file_upload",
                            "file_upload": { "id": upload_id }
                        }
                    })

                # 4. Create the Notion Page using the injected file blocks
                notion_payload = {
                    "parent": { "database_id": NOTION_DB_ID },
                    "properties": {
                        "Name": { "title": [{"text": {"content": "New Auto-Synced Cluster"}}] }
                    },
                    "children": children_blocks[:100]
                }
                requests.post("https://api.notion.com/v1/pages", headers=notion_headers, json=notion_payload)

                # 5. Clean up Dropbox (Delete photos so they aren't processed twice)
                for photo in cluster:
                    dbx.files_delete_v2(photo["path"])
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "success"}).encode())

        except Exception as e:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(str(e).encode())