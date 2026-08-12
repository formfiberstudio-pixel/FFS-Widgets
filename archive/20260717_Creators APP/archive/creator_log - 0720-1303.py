import os
import json
import requests
from dotenv import load_dotenv
from notion_client import Client

# Load environment variables from .env file
load_dotenv()

# Initialize Notion client using environment variables
notion = Client(auth=os.getenv("NOTION_TOKEN"))
database_id = os.getenv("NOTION_DATABASE_ID")

# Cache to avoid duplicate API calls for the same related project page
project_title_cache = {}

def get_related_project_name(relation_list):
    """Fetches the title of a related project page from its ID."""
    if not relation_list:
        return "Untitled Project"
    
    page_id = relation_list[0].get("id")
    if not page_id:
        return "Untitled Project"
        
    if page_id in project_title_cache:
        return project_title_cache[page_id]
        
    try:
        related_page = notion.pages.retrieve(page_id=page_id)
        rel_props = related_page.get("properties", {})
        for prop_name, prop_val in rel_props.items():
            if prop_val.get("type") == "title":
                title_arr = prop_val.get("title", [])
                if title_arr:
                    title_text = title_arr[0].get("plain_text", "Untitled Project")
                    project_title_cache[page_id] = title_text
                    return title_text
    except Exception as e:
        print(f"Could not fetch related page {page_id}: {e}")
        
    return "Untitled Project"

def download_image(url, page_id):
    """Downloads remote images locally into public/images to prevent expiration/broken links."""
    if not url:
        return None
    try:
        img_dir = os.path.join("public", "images")
        os.makedirs(img_dir, exist_ok=True)
        
        ext = "jpg"
        if "?" in url:
            base_url = url.split("?")[0]
            if "." in base_url:
                ext = base_url.split(".")[-1].lower()
                if ext not in ["jpg", "jpeg", "png", "webp", "gif"]:
                    ext = "jpg"

        filename = f"{page_id}.{ext}"
        filepath = os.path.join(img_dir, filename)

        response = requests.get(url, stream=True)
        if response.status_code == 200:
            with open(filepath, "wb") as f:
                for chunk in response.iter_content(1024):
                    f.write(chunk)
            return f"/images/{filename}"
    except Exception as e:
        print(f"Failed to download image for {page_id}: {e}")
    return url

def main():
    print("Fetching data from Notion database...")
    response = notion.databases.query(database_id=database_id)
    pages = response.get("results", [])
    
    logs = []

    for page in pages:
        properties = page.get("properties", {})
        page_id = page.get("id")

        # 1. Extract Entry Title (Name property)
        name_prop = properties.get("Name", {}).get("title", [])
        entry_title = name_prop[0].get("plain_text", "Untitled") if name_prop else "Untitled"

        # 2. Extract Parent Project Name (Project Name relation)
        relation_prop = properties.get("Project Name", {}).get("relation", [])
        project_name = get_related_project_name(relation_prop)

        # 3. Extract Project Type and Notion Select Color (Project Type rollup -> select)
        project_type = "General"
        project_type_color = "default"
        
        rollup_prop = properties.get("Project Type", {}).get("rollup", {})
        array_items = rollup_prop.get("array", [])
        if array_items:
            first_item = array_items[0]
            if first_item.get("type") == "select":
                select_data = first_item.get("select", {})
                project_type = select_data.get("name", "General")
                project_type_color = select_data.get("color", "default")

        # 4. Extract Date from Post-Date property
        year, month, day = 2026, 7, 20  # Fallbacks
        date_prop = properties.get("Post-Date", {}).get("date")
        if date_prop and date_prop.get("start"):
            date_str = date_prop.get("start")  # Format: "YYYY-MM-DD"
            parts = date_str.split("-")
            if len(parts) == 3:
                year, month, day = int(parts[0]), int(parts[1]), int(parts[2])

        # 5. Extract Image URL (Cover image first, fallback to page blocks)
        raw_image_url = None
        cover = page.get("cover")
        if cover:
            if cover.get("type") == "external":
                raw_image_url = cover.get("external", {}).get("url")
            elif cover.get("type") == "file":
                raw_image_url = cover.get("file", {}).get("url")

        if not raw_image_url:
            try:
                blocks = notion.blocks.children.list(block_id=page_id).get("results", [])
                for block in blocks:
                    if block.get("type") == "image":
                        img_block = block.get("image", {})
                        if img_block.get("type") == "external":
                            raw_image_url = img_block.get("external", {}).get("url")
                        elif img_block.get("type") == "file":
                            raw_image_url = img_block.get("file", {}).get("url")
                        break
            except Exception:
                pass

        local_image_path = download_image(raw_image_url, page_id)

        # 6. Construct structured log entry matching App.jsx expectations
        log_entry = {
            "title": entry_title,
            "Projects": project_name,
            "projectType": project_type,
            "projectTypeColor": project_type_color,
            "year": year,
            "monthNumber": month,
            "dayNumber": day,
            "imageUrl": local_image_path
        }
        
        logs.append(log_entry)

    # 7. Write output to src/data/logs.json
    output_dir = os.path.join("src", "data")
    os.makedirs(output_dir, exist_ok=True)
    
    output_path = os.path.join(output_dir, "logs.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(logs, f, ensure_ascii=False, indent=2)

    print(f"Successfully compiled {len(logs)} entries to {output_path}")

if __name__ == "__main__":
    main()