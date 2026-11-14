# Predefined_username = "Sandeep"
# Predefined_password = "Pass104"

# username=input("Enter the username: ")
# password=input("Enter the password: ")


# if username==Predefined_username:
#     if password==Predefined_password:
#         print("Login Successfull")
#     else:
#         print("Password is incorrect")
# else:
#     print("Inavlid Username")


marks_in_math=int(input("Marks Scored in Maths: "))
marks_in_physics=int(input("Marks Scored in Physics: "))
marks_in_chemistry=int(input("Marks Scored in Chemistry: "))

total_marks_in_three_subjects=marks_in_math+marks_in_physics+marks_in_chemistry
total_marks_maths_physics=marks_in_math+marks_in_physics


if (marks_in_math>=65 and marks_in_chemistry>=50 and marks_in_physics>=55
    and total_marks_in_three_subjects>=180) or (total_marks_maths_physics>=140):
    print("Student is eligible for ADMISSION")
else:
    print("Not eligible")
