import sys
str_val = sys.stdin.readline().rstrip('\n')

result = ""

for ch in str_val:
    if ch not in result:
        result+=ch

print(result)        