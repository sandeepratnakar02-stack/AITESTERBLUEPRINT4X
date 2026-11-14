import sys
line = sys.stdin.readline().rstrip('\n').rstrip('\r').lower()

vowels = 0
consonants = 0

for ch in line.lower():

    if ch in "aeiou":
        vowels += 1

    elif ch.isalpha():
        consonants += 1

print("Vowels:", vowels)
print("Consonants:", consonants)