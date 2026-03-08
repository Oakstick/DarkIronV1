import json

path = r"D:\DarkIron\darkiron\package.json"
with open(path, "r") as f:
    pkg = json.load(f)

# Remove nats from root dependencies — it belongs only in packages/transport
if "dependencies" in pkg and "nats" in pkg["dependencies"]:
    del pkg["dependencies"]["nats"]
    if not pkg["dependencies"]:
        del pkg["dependencies"]
    print("Removed 'nats' from root package.json dependencies")

with open(path, "w") as f:
    json.dump(pkg, f, indent=2)
    f.write("\n")

