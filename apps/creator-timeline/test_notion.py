import os
from dotenv import load_dotenv
from notion_client import Client

load_dotenv(override=True)

token = os.getenv("NOTION_TOKEN")
notion = Client(auth=token)

print("🔎 Searching Notion for accessible databases...\n")
try:
    # Query Notion's search endpoint for databases accessible by this token
    response = notion.search(**{"filter": {"value": "database", "property": "object"}})
    results = response.get("results", [])
    
    if not results:
        print("❌ NO DATABASES FOUND!")
        print("This means the integration 'Creators Calendar Test' cannot see ANY database in this workspace.")
        print("Possible reasons:")
        print(" 1. The integration is not connected to the top-level parent page.")
        print(" 2. The NOTION_TOKEN in .env belongs to a different workspace or account.")
    else:
        print(f"✅ Found {len(results)} accessible database(s):\n")
        for db in results:
            db_id = db.get("id")
            title_list = db.get("title", [])
            title_text = "".join([t.get("plain_text", "") for t in title_list]) or "Untitled Database"
            print(f"📌 Name: {title_text}")
            print(f"   ID:   {db_id}")
            print("   ---")

except Exception as e:
    print(f"❌ Error during search: {e}")