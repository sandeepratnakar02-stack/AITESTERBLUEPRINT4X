import sys
line = sys.stdin.readline().rstrip('\n').rstrip('\r').lower()
# Write your solution here

# if line == line[::-1]:
#     print("YES")
# else:
#     print("NO")


reverse = ""

for ch in line:
    reverse = ch + reverse
print(reverse)

if line == reverse:
    print("YES")
else:
    print("NO")