import json

path = r"D:\DarkIron\darkiron\packages\editor\package.json"
with open(path, "r") as f:
    pkg = json.load(f)

# Remove direct nats.ws dep from editor — it comes via @darkiron/transport
if "nats.ws" in pkg.get("dependencies", {}):
    del pkg["dependencies"]["nats.ws"]
    print("Removed 'nats.ws' from editor dependencies (comes via @darkiron/transport)")

with open(path, "w") as f:
    json.dump(pkg, f, indent=2)
    f.write("\n")

