import json
import requests
import base64
import math
from http.server import BaseHTTPRequestHandler
from datetime import datetime
from dateutil import parser
from timezonefinder import TimezoneFinder 

def parse_iso(date_str):
    try:
        return parser.parse(str(date_str))
    except Exception:
        return datetime.now()

def haversine(lat1, lon1, lat2, lon2):
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda/2)**2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def get_location_name(lat, lon):
    if lat is None or lon is None:
        return None
    try:
        headers = {'User-Agent': 'NotionTravelLog/2.0'}
        url = f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}&format=json"
        res = requests.get(url, headers=headers, timeout=3)
        if res.ok:
            data = res.json()
            address = data.get('address', {})
            road = address.get('road') or address.get('pedestrian') or address.get('suburb')
            house_number = address.get('house_number', '')
            if road and house_number: return f"{house_number} {road}"
            elif road: return road
            elif address.get('city'): return address.get('city')
            elif data.get('display_name'): return data.get('display_name').split(',')[0]
    except Exception:
        pass
    return None

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length)
        
        try:
            data = json.loads(post_data)
            notion_token = data.get('notionToken')
            db_id = data.get('databaseId')
            photos = data.get('photos', [])
            
            if not notion_token or not db_id or not photos:
                self.send_error_response(400, "Missing credentials or photo data.")
                return

            photos.sort(key=lambda x: parse_iso(x.get('date')))

            # --- ANCHOR CLUSTERING LOGIC ---
            clusters = []
            current_cluster = []
            anchor_lat = None
            anchor_lon = None
            
            for photo in photos:
                curr_time = parse_iso(photo.get('date'))
                curr_lat = float(photo.get('lat')) if photo.get('lat') is not None else None
                curr_lon = float(photo.get('lon')) if photo.get('lon') is not None else None

                if not current_cluster:
                    current_cluster.append(photo)
                    anchor_lat, anchor_lon = curr_lat, curr_lon
                    continue

                last_photo_time = parse_iso(current_cluster[-1].get('date'))
                time_gap = (curr_time - last_photo_time).total_seconds()

                if anchor_lat is None and curr_lat is not None:
                    anchor_lat, anchor_lon = curr_lat, curr_lon

                is_close = True
                if anchor_lat is not None and curr_lat is not None:
                    dist = haversine(anchor_lat, anchor_lon, curr_lat, curr_lon)
                    is_close = dist <= 250
                
                if time_gap <= 2700 and is_close:
                    current_cluster.append(photo)
                else:
                    clusters.append(current_cluster)
                    current_cluster = [photo]
                    anchor_lat, anchor_lon = curr_lat, curr_lon
            
            if current_cluster:
                clusters.append(current_cluster)

            notion_headers_core = {
                "Authorization": f"Bearer {notion_token}",
                "Content-Type": "application/json",
                "Notion-Version": "2022-06-28"
            }
            
            # File Uploads require the latest API version header
            notion_headers_file = {
                "Authorization": f"Bearer {notion_token}",
                "Content-Type": "application/json",
                "Notion-Version": "2026-03-11"
            }
            
            tf = TimezoneFinder()

            for cluster in clusters:
                valid_lats = [float(p['lat']) for p in cluster if p.get('lat') is not None]
                valid_lons = [float(p['lon']) for p in cluster if p.get('lon') is not None]

                avg_lat = sum(valid_lats) / len(valid_lats) if valid_lats else None
                avg_lon = sum(valid_lons) / len(valid_lons) if valid_lons else None
                
                parsed_date = parse_iso(cluster[0].get('date'))
                start_time = parsed_date.strftime("%Y-%m-%dT%H:%M:%S")
                
                location_name = get_location_name(avg_lat, avg_lon)
                cluster_title = location_name if location_name else f"Photo Entry ({parsed_date.strftime('%b %d, %I:%M %p')})"

                tz_string = tf.timezone_at(lng=avg_lon, lat=avg_lat) if avg_lat and avg_lon else None

                children_blocks = []
                for photo in cluster:
                    b64_str = photo.get('base64_data', '')
                    if ',' in b64_str:
                        b64_str = b64_str.split(',')[1]
                    file_bytes = base64.b64decode(b64_str)
                    filename = photo.get('name', 'photo.jpg')

                    # 1. Create a Notion file upload object
                    create_payload = {"mode": "single_part", "filename": filename, "content_type": "image/jpeg"}
                    upload_res = requests.post("https://api.notion.com/v1/file_uploads", headers=notion_headers_file, json=create_payload)
                    upload_id = upload_res.json().get("id")

                    if upload_id:
                        # 2. Send the file bytes via multipart/form-data
                        send_headers = {"Authorization": f"Bearer {notion_token}", "Notion-Version": "2026-03-11"}
                        requests.post(
                            f"https://api.notion.com/v1/file_uploads/{upload_id}/send", 
                            headers=send_headers,
                            files={"file": (filename, file_bytes, "image/jpeg")}
                        )

                        # 3. Complete the upload
                        requests.post(f"https://api.notion.com/v1/file_uploads/{upload_id}/complete", headers=notion_headers_file)

                        # 4. Correctly structure the block for Notion's file upload API
                        children_blocks.append({
                            "object": "block",
                            "type": "image",
                            "image": {
                                "type": "file_upload",
                                "file_upload": { "id": upload_id }
                            }
                        })

                notion_payload = {
                    "parent": { "database_id": db_id },
                    "properties": {
                        "Name": { "title": [{"text": {"content": cluster_title}}] },
                        "Date": { "date": {"start": start_time} }
                    },
                    "children": children_blocks[:100] 
                }

                if tz_string: notion_payload["properties"]["Date"]["date"]["time_zone"] = tz_string
                if avg_lat is not None: notion_payload["properties"]["Latitude"] = { "number": avg_lat }
                if avg_lon is not None: notion_payload["properties"]["Longitude"] = { "number": avg_lon }

                notion_res = requests.post("https://api.notion.com/v1/pages", headers=notion_headers_core, json=notion_payload)
                if not notion_res.ok:
                    self.send_error_response(notion_res.status_code, f"Notion API Error: {notion_res.text}")
                    return

            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "success", "message": f"Created {len(clusters)} activity clusters."}).encode())

        except Exception as e:
            self.send_error_response(500, f"Python Server Error: {str(e)}")

    def send_error_response(self, status, message):
        self.send_response(status)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"error": message}).encode())